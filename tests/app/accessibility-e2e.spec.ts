import { test, expect, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../helpers/a11y";

type PublicPageCase = {
  name: string;
  path: string;
  waitFor: (page: Page) => Promise<void>;
};

const publicPages: PublicPageCase[] = [
  {
    name: "landingssiden",
    path: "/",
    waitFor: async (page) => {
      await expect(page.getByRole("main").first()).toBeVisible();
      await expect(page.locator("nav, header").first()).toBeVisible();
    },
  },
  {
    name: "kontakt-siden",
    path: "/kontakt",
    waitFor: async (page) => {
      await expect(page.getByRole("main").first()).toBeVisible();
      await expect(page.locator("form")).toBeVisible();
    },
  },
  {
    name: "personvern-siden",
    path: "/personvern",
    waitFor: async (page) => {
      await expect(page.getByRole("main").first()).toBeVisible();
    },
  },
];

test.describe("Tilgjengelighet — offentlige sider", () => {
  for (const pageCase of publicPages) {
    test(`${pageCase.name} har ingen alvorlige eller kritiske a11y-brudd`, async ({ page }) => {
      await page.goto(pageCase.path);
      await page.waitForLoadState("domcontentloaded");
      await pageCase.waitFor(page);
      await expectNoSeriousA11yViolations(page);
    });
  }
});
