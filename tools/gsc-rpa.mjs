#!/usr/bin/env node

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const GSC_WELCOME_URL = "https://search.google.com/search-console/welcome";
const DEFAULT_TIMEOUT_MS = 180_000;

const usage = `
Google Search Console RPA

Usage:
  npm run gsc:add -- --site http://example.com/ --sitemap sitemap.xml --verification-file googlexxxx.html

Options:
  --site <url>                 Required. URL-prefix property, including http:// or https://.
  --sitemap <path|url>          Sitemap path or URL. Default: sitemap.xml
  --verification-file <file>    Existing Google HTML verification file.
  --repo <path>                 Repo path for writing a discovered verification file. Default: cwd
  --profile <path>              Optional persistent browser profile. Default: ephemeral session
  --channel <name>              Browser channel. Default: chrome
  --submit-only                 Skip adding/verifying property; only open sitemap page and submit.
  --dry-run                     Only validate inputs and public URLs; do not open the browser.
  --no-preflight                Skip public URL checks before browser automation.
  --timeout <ms>                Browser action timeout. Default: 180000
  --help                        Show this help.

Safety:
  - The tool never asks for, stores, or prints Google passwords.
  - Login, 2FA, CAPTCHA, and account permission prompts stay manual.
  - Without --profile, browser login state is discarded when the run ends.
`;

function parseArgs(argv) {
  const args = {
    sitemap: "sitemap.xml",
    repo: process.cwd(),
    channel: "chrome",
    timeout: DEFAULT_TIMEOUT_MS,
    preflight: true,
    submitOnly: false,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--site") {
      args.site = readValue(arg, next);
      i += 1;
    } else if (arg === "--sitemap") {
      args.sitemap = readValue(arg, next);
      i += 1;
    } else if (arg === "--verification-file") {
      args.verificationFile = readValue(arg, next);
      i += 1;
    } else if (arg === "--repo") {
      args.repo = readValue(arg, next);
      i += 1;
    } else if (arg === "--profile") {
      args.profile = readValue(arg, next);
      i += 1;
    } else if (arg === "--channel") {
      args.channel = readValue(arg, next);
      i += 1;
    } else if (arg === "--timeout") {
      args.timeout = Number(readValue(arg, next));
      i += 1;
    } else if (arg === "--submit-only") {
      args.submitOnly = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--no-preflight") {
      args.preflight = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function readValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function normalizeSite(rawSite) {
  if (!rawSite) {
    throw new Error("--site is required");
  }

  const site = new URL(rawSite);
  if (!["http:", "https:"].includes(site.protocol)) {
    throw new Error("--site must start with http:// or https://");
  }

  if (!site.pathname) {
    site.pathname = "/";
  }

  if (!site.pathname.endsWith("/")) {
    site.pathname = `${site.pathname}/`;
  }

  site.hash = "";
  site.search = "";
  return site.href;
}

function buildPublicUrl(site, value) {
  return new URL(value, site).href;
}

function sitemapInputValue(site, sitemap) {
  try {
    const sitemapUrl = new URL(sitemap);
    if (sitemapUrl.href.startsWith(site)) {
      return sitemapUrl.href.slice(site.length);
    }
    return sitemapUrl.href;
  } catch {
    return sitemap.replace(/^\/+/, "");
  }
}

function gscSitemapUrl(site) {
  return `https://search.google.com/search-console/sitemaps?resource_id=${encodeURIComponent(site)}`;
}

async function checkPublicUrl(url, label, required = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    });
    const ok = response.ok;
    console.log(`${ok ? "OK" : "WARN"} ${label}: ${response.status} ${url}`);
    if (!ok && required) {
      throw new Error(`${label} is not reachable: ${response.status} ${url}`);
    }
    return ok;
  } catch (error) {
    console.log(`WARN ${label}: ${error.message}`);
    if (required) {
      throw error;
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function launchContext(options) {
  const browserOptions = {
    channel: options.channel,
    headless: false,
    timeout: options.timeout
  };

  const contextOptions = {
    acceptDownloads: true,
    downloadsPath: path.resolve(options.repo, ".gsc-rpa-downloads"),
    viewport: { width: 1440, height: 1000 }
  };

  if (options.profile) {
    const profileDir = path.resolve(options.repo, options.profile);
    await mkdir(profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDir, {
      ...browserOptions,
      ...contextOptions
    });
    return { context, close: () => context.close() };
  }

  const browser = await chromium.launch(browserOptions);
  const context = await browser.newContext(contextOptions);
  return {
    context,
    close: async () => {
      await context.close();
      await browser.close();
    }
  };
}

async function waitForManual(rl, message) {
  await rl.question(`${message}\nPress Enter to continue...`);
}

async function saveBlockedScreenshot(page, repo, name) {
  const outputDir = path.resolve(repo, ".gsc-rpa-output");
  await mkdir(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, `${Date.now()}-${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
  console.log(`Saved screenshot: ${screenshotPath}`);
}

async function handleManualAuth(page, rl) {
  if (/accounts\.google\.com/.test(page.url())) {
    await waitForManual(
      rl,
      "Google login, 2FA, or CAPTCHA is required. Complete it in the opened browser."
    );
  }
}

async function gotoGsc(page, url, rl, options) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeout });
  await handleManualAuth(page, rl);
  await page.waitForLoadState("domcontentloaded", { timeout: options.timeout }).catch(() => null);
  await page.waitForTimeout(2000);
}

async function visibleLocator(locator) {
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 8); i += 1) {
    const item = locator.nth(i);
    if (await item.isVisible().catch(() => false)) {
      return item;
    }
  }
  return null;
}

async function clickButton(page, names, description, rl, options) {
  const pattern = new RegExp(names.map(escapeRegExp).join("|"), "i");
  const roleButton = page.getByRole("button", { name: pattern });
  const roleMatch = await visibleLocator(roleButton);

  if (roleMatch) {
    await roleMatch.click({ timeout: options.timeout });
    await page.waitForTimeout(2500);
    return true;
  }

  const textButton = page.locator("button").filter({ hasText: pattern });
  const textMatch = await visibleLocator(textButton);
  if (textMatch) {
    await textMatch.click({ timeout: options.timeout });
    await page.waitForTimeout(2500);
    return true;
  }

  await saveBlockedScreenshot(page, options.repo, `missing-${slug(description)}`);
  await waitForManual(rl, `Could not find ${description}. Click it manually in the browser.`);
  return false;
}

async function fillUrlPrefixInput(page, site, rl, options) {
  const inputs = page.locator("input");
  const count = await inputs.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const inputNode = inputs.nth(i);
    if (!(await inputNode.isVisible().catch(() => false))) {
      continue;
    }

    const placeholder = await inputNode.getAttribute("placeholder").catch(() => "");
    const ariaLabel = await inputNode.getAttribute("aria-label").catch(() => "");
    const name = `${placeholder || ""} ${ariaLabel || ""}`;

    if (/https:\/\/www\.example\.com|url|网址|前缀/i.test(name)) {
      await inputNode.fill(site, { timeout: options.timeout });
      return true;
    }
  }

  const visibleInputs = [];
  for (let i = 0; i < count; i += 1) {
    const inputNode = inputs.nth(i);
    if (await inputNode.isVisible().catch(() => false)) {
      visibleInputs.push(inputNode);
    }
  }

  if (visibleInputs.length === 1) {
    await visibleInputs[0].fill(site, { timeout: options.timeout });
    return true;
  }

  await saveBlockedScreenshot(page, options.repo, "missing-url-prefix-input");
  await waitForManual(
    rl,
    `Could not identify the URL-prefix input. Enter this URL manually: ${site}`
  );
  return false;
}

async function fillSitemapInput(page, sitemapValue, rl, options) {
  const selectors = [
    'input[placeholder*="Enter sitemap URL"]',
    'input[aria-label*="sitemap" i]',
    'input[placeholder*="sitemap" i]'
  ];

  for (const selector of selectors) {
    const match = await visibleLocator(page.locator(selector));
    if (match) {
      await match.fill(sitemapValue, { timeout: options.timeout });
      return true;
    }
  }

  const inputs = page.locator("input");
  const visibleInputs = [];
  const count = await inputs.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const inputNode = inputs.nth(i);
    if (await inputNode.isVisible().catch(() => false)) {
      visibleInputs.push(inputNode);
    }
  }

  if (visibleInputs.length === 1) {
    await visibleInputs[0].fill(sitemapValue, { timeout: options.timeout });
    return true;
  }

  await saveBlockedScreenshot(page, options.repo, "missing-sitemap-input");
  await waitForManual(
    rl,
    `Could not identify the sitemap input. Enter this value manually: ${sitemapValue}`
  );
  return false;
}

async function extractVerificationFile(page) {
  const bodyText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
  const match = bodyText.match(/google[a-z0-9_-]+\.html/i);
  return match?.[0] || null;
}

async function ensureVerificationFile(page, site, options, rl) {
  let verificationFile = options.verificationFile;

  if (!verificationFile) {
    verificationFile = await extractVerificationFile(page);
    if (verificationFile) {
      const verificationPath = path.resolve(options.repo, verificationFile);
      const content = `google-site-verification: ${verificationFile}\n`;
      await writeFile(verificationPath, content, { flag: "wx" }).catch((error) => {
        if (error.code !== "EEXIST") {
          throw error;
        }
      });
      console.log(`Created verification file: ${verificationPath}`);
      await waitForManual(
        rl,
        [
          "Deploy the verification file before continuing.",
          `Suggested commands: git add ${verificationFile} && git commit -m "Add Google Search Console verification file" && git push`
        ].join("\n")
      );
    }
  }

  if (!verificationFile) {
    await saveBlockedScreenshot(page, options.repo, "missing-verification-file");
    await waitForManual(
      rl,
      "Could not discover the Google HTML verification filename. Download or create the HTML file, deploy it, then continue."
    );
    verificationFile = await extractVerificationFile(page);
  }

  if (verificationFile) {
    const verificationUrl = buildPublicUrl(site, verificationFile);
    await checkPublicUrl(verificationUrl, "verification file", false);
  }

  return verificationFile;
}

async function addAndVerifyProperty(page, site, options, rl) {
  console.log(`Opening GSC property setup: ${GSC_WELCOME_URL}`);
  await gotoGsc(page, GSC_WELCOME_URL, rl, options);

  const bodyText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
  if (!/google search console|search console|资源类型|property type|domain|url prefix|网址前缀/i.test(bodyText)) {
    await saveBlockedScreenshot(page, options.repo, "unexpected-welcome-page");
    await waitForManual(
      rl,
      "The GSC welcome page did not look ready. Navigate to the URL-prefix add-property dialog manually."
    );
  }

  await fillUrlPrefixInput(page, site, rl, options);
  await clickButton(page, ["continue", "继续", "下一步"], "Continue button", rl, options);
  await handleManualAuth(page, rl);

  const verificationFile = await ensureVerificationFile(page, site, options, rl);

  await clickButton(page, ["verify", "验证"], "Verify button", rl, options);
  await page.waitForTimeout(4000);

  const postVerifyText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
  if (/ownership verified|verified|所有权已验证|验证成功/i.test(postVerifyText)) {
    console.log(`OK property verified${verificationFile ? ` with ${verificationFile}` : ""}`);
    await clickButton(page, ["go to property", "前往资源", "done", "完成"], "Go to property or Done button", rl, options).catch(() => null);
  } else if (/couldn.t verify|verification failed|验证失败|无法验证/i.test(postVerifyText)) {
    await saveBlockedScreenshot(page, options.repo, "verification-failed");
    await waitForManual(
      rl,
      "GSC reported verification failure. Fix the public verification file or method, then click Verify manually."
    );
  } else {
    console.log("WARN verification result was not recognized. Continuing to sitemap submission.");
  }
}

async function submitSitemap(page, site, sitemap, options, rl) {
  const sitemapPage = gscSitemapUrl(site);
  const sitemapValue = sitemapInputValue(site, sitemap);

  console.log(`Opening GSC sitemap page: ${sitemapPage}`);
  await gotoGsc(page, sitemapPage, rl, options);
  await fillSitemapInput(page, sitemapValue, rl, options);
  await clickButton(page, ["submit", "提交"], "Submit sitemap button", rl, options);
  await page.waitForTimeout(4000);

  const bodyText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
  if (/sitemap submitted successfully|已成功提交|提交成功/i.test(bodyText)) {
    console.log(`OK sitemap submitted: ${sitemapValue}`);
    await clickButton(page, ["got it", "done", "完成", "知道了"], "Sitemap confirmation button", rl, options).catch(() => null);
  } else if (/couldn.t fetch|couldn't fetch|无法抓取|错误|error/i.test(bodyText)) {
    console.log("WARN sitemap page shows a fetch/error state. Check GSC after Google refreshes the sitemap.");
  } else {
    console.log("WARN sitemap submission result was not recognized. Check the browser page.");
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage.trim());
    return;
  }

  options.repo = path.resolve(options.repo);
  const site = normalizeSite(options.site);
  const sitemapUrl = buildPublicUrl(site, options.sitemap);

  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    throw new Error("--timeout must be a positive number");
  }

  console.log(`Site: ${site}`);
  console.log(`Sitemap: ${sitemapUrl}`);
  console.log(`Browser: ${options.channel}${options.profile ? ` with profile ${options.profile}` : " with ephemeral session"}`);

  if (options.preflight) {
    if (options.verificationFile && !options.submitOnly) {
      await checkPublicUrl(buildPublicUrl(site, options.verificationFile), "verification file", false);
    }
    await checkPublicUrl(sitemapUrl, "sitemap", false);
  }

  if (options.dryRun) {
    console.log("Dry run complete. Browser automation was not started.");
    return;
  }

  const rl = createInterface({ input, output });
  const session = await launchContext(options);

  try {
    const page = session.context.pages()[0] || await session.context.newPage();
    page.setDefaultTimeout(options.timeout);

    if (!options.submitOnly) {
      await addAndVerifyProperty(page, site, options, rl);
    }

    await submitSitemap(page, site, options.sitemap, options, rl);
    console.log("Done.");
  } finally {
    await session.close();
    rl.close();
  }
}

main().catch((error) => {
  console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
});
