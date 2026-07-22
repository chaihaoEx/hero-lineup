import { expect, type Page, test } from "@playwright/test";

const localHosts = new Set(["127.0.0.1", "localhost"]);

/**
 * Browser-preview E2E must never become dependent on a remote resource. The
 * route guard fails closed, while the request ledger lets every test prove the
 * invariant after exercising its UI path.
 */
export async function installOfflineGuard(page: Page): Promise<string[]> {
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:")
      && !localHosts.has(url.hostname)) remoteRequests.push(request.url());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if ((url.protocol === "http:" || url.protocol === "https:") && !localHosts.has(url.hostname)) {
      remoteRequests.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return remoteRequests;
}

export async function openPreview(page: Page): Promise<string[]> {
  const remoteRequests = await installOfflineGuard(page);
  await page.goto("/");
  await expect(page.locator(".online-system-card.active > strong")).toHaveText("默认体系");
  return remoteRequests;
}

export function assertOffline(remoteRequests: string[]): Promise<void> {
  return test.step("没有发起远程网络请求", () => {
    expect(remoteRequests).toEqual([]);
  });
}
