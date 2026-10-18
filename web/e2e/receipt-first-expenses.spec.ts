import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const OWNER = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

async function waitForDatabase(page: Page) {
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve) => {
    const open = indexedDB.open("locum-manager");
    open.onsuccess = () => {
      const ready = open.result.objectStoreNames.contains("expenses");
      open.result.close();
      resolve(ready);
    };
    open.onerror = () => resolve(false);
  }))).toBe(true);
}

async function chooseProfession(page: Page, profession: "GP" | "Pharmacist" = "GP") {
  await page.goto("/expenses/new");
  await waitForDatabase(page);
  if (await page.getByRole("heading", { name: "Choose your profession" }).isVisible()) {
    await page.getByLabel(profession, { exact: true }).check();
    const syncFinished = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/sync" && response.request().method() === "POST";
    });
    await page.getByRole("button", { name: "Save and continue" }).click();
    await syncFinished;
  }
  await expect(page.getByRole("heading", { name: "How would you like to add this expense?" })).toBeVisible();
}

async function ensureServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function fictionalReceiptPng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.font = "bold 64px Arial";
    context.fillText("Fictional Medical Supplies", 70, 130);
    context.font = "56px Arial";
    context.fillText("12/08/2026", 70, 280);
    context.fillText("TOTAL 42.99", 70, 430);
    context.font = "42px Arial";
    context.fillText("RAW_OCR_SENTINEL_NEVER_PERSIST", 70, 600);
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

type TidyTarget = { locator: Locator; minimum?: 44 | 48; name: string };

const PRIMARY_EXPENSE_QUESTIONS = [
  "What did you buy?",
  "How much did it cost?",
  "When did you buy it?",
  "What type of expense is it?",
  "Which practice?",
];

const activeExpenseForm = (page: Page) => page.locator("form.expense-form:visible");

const editableReceiptRow = (page: Page) => activeExpenseForm(page).getByTestId("receipt-attachment-row");

const receiptSurface = (page: Page) => editableReceiptRow(page).locator(".expense-receipt-swipe__surface");

const receiptOptions = (page: Page) => activeExpenseForm(page).getByRole("button", { name: "Receipt options" });

const receiptTrayActions = (page: Page) => editableReceiptRow(page).locator(".expense-receipt-swipe__tray > button");

const primaryExpenseTargets = (page: Page, saveLabel = "Save expense"): TidyTarget[] => [
  { locator: activeExpenseForm(page).getByLabel("What did you buy?"), minimum: 48, name: "purchase" },
  { locator: activeExpenseForm(page).getByLabel("How much did it cost?"), minimum: 48, name: "amount" },
  { locator: activeExpenseForm(page).getByLabel("When did you buy it?"), minimum: 48, name: "date" },
  { locator: activeExpenseForm(page).getByLabel("What type of expense is it?"), minimum: 48, name: "category" },
  { locator: activeExpenseForm(page).getByLabel("Which practice?"), minimum: 48, name: "practice" },
  { locator: activeExpenseForm(page).locator(".expense-form__receipt-row"), name: "receipt row" },
  { locator: activeExpenseForm(page).locator(".record-form__advanced > summary"), name: "more details" },
  { locator: activeExpenseForm(page).getByRole("button", { name: saveLabel }), name: "save" },
];

const advancedExpenseTargets = (page: Page): TidyTarget[] => [
  { locator: activeExpenseForm(page).getByLabel("HMRC expense category"), name: "HMRC category" },
  { locator: activeExpenseForm(page).getByLabel("Business-use percentage"), name: "business-use percentage" },
  { locator: activeExpenseForm(page).getByLabel("Notes", { exact: true }), name: "notes" },
  { locator: activeExpenseForm(page).locator(".record-form__check").filter({ hasText: "Reimbursed by practice" }), name: "reimbursed" },
  { locator: activeExpenseForm(page).locator(".record-form__check").filter({ hasText: "Review with accountant" }), name: "accountant review" },
];

async function expectTidyExpenseForm(
  page: Page,
  expectedTargets: TidyTarget[],
  widths = [320, 375, 390],
  expectedQuestionLabels: string[] = PRIMARY_EXPENSE_QUESTIONS,
) {
  expect(expectedTargets.length).toBeGreaterThan(0);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    const form = activeExpenseForm(page);
    await expect(form, `active expense form is unique at ${width}px`).toHaveCount(1);
    for (const target of expectedTargets) {
      await expect(target.locator, `${target.name} is unique at ${width}px`).toHaveCount(1);
      await expect(target.locator, `${target.name} is visible at ${width}px`).toBeVisible();
      const box = await target.locator.boundingBox();
      expect(box, `${target.name} has non-zero geometry at ${width}px`).not.toBeNull();
      expect(box!.width, `${target.name} width at ${width}px`).toBeGreaterThanOrEqual(target.minimum ?? 44);
      expect(box!.height, `${target.name} height at ${width}px`).toBeGreaterThanOrEqual(target.minimum ?? 44);
    }
    if (expectedQuestionLabels.length) {
      const questionOrder = await form.getByTestId("expense-primary-fields")
        .locator(":scope > .record-form__field > label")
        .allTextContents();
      expect(questionOrder).toEqual(expectedQuestionLabels);
    }
    const geometry = await form.evaluate((activeForm) => {
      const viewportWidth = document.documentElement.clientWidth;
      const visible = (selector: string) => [...activeForm.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        .filter((element) => element.getClientRects().length > 0);
      const formControls = visible(".record-form__control");
      const actionTargets = visible([
        ".record-form__advanced > summary",
        ".record-form__actions .button",
        ".expense-form__receipt-action",
        ".expense-receipt-swipe__summary",
        ".expense-receipt-swipe__options",
        ".expense-receipt-swipe__action",
        ".expense-receipt-swipe__fallback-action",
      ].join(", "));
      const allTargets = [...formControls, ...actionTargets];
      return {
        clientWidth: viewportWidth,
        controlsContained: allTargets.every((target) => {
          const box = target.getBoundingClientRect();
          return box.left >= 0 && box.right <= viewportWidth;
        }),
        formControlsAtLeast48: formControls.every((target) => {
          const box = target.getBoundingClientRect();
          return box.width >= 48 && box.height >= 48;
        }),
        formPresent: activeForm.matches("form.expense-form"),
        minimumTouchTargets: actionTargets.every((target) => {
          const box = target.getBoundingClientRect();
          return box.width >= 44 && box.height >= 44;
        }),
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(geometry).toEqual({
      clientWidth: width,
      controlsContained: true,
      formControlsAtLeast48: true,
      formPresent: true,
      minimumTouchTargets: true,
      scrollWidth: width,
    });
  }
}

async function expectExactActionTargets(
  page: Page,
  targets: TidyTarget[],
  widths = [320, 375, 390],
) {
  expect(targets.length).toBeGreaterThan(0);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await expect(activeExpenseForm(page), `active expense form is unique at ${width}px`).toHaveCount(1);
    for (const target of targets) {
      await expect(target.locator, `${target.name} is unique at ${width}px`).toHaveCount(1);
      await expect(target.locator, `${target.name} is visible at ${width}px`).toBeVisible();
      const box = await target.locator.boundingBox();
      expect(box, `${target.name} has non-zero geometry at ${width}px`).not.toBeNull();
      expect(box!.width, `${target.name} width at ${width}px`).toBeGreaterThanOrEqual(target.minimum ?? 44);
      expect(box!.height, `${target.name} height at ${width}px`).toBeGreaterThanOrEqual(target.minimum ?? 44);
    }
  }
}

function captureConsole(page: Page) {
  const output: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") output.push(`error: ${message.text()}`);
  });
  page.on("pageerror", (error) => output.push(`pageerror: ${error.message}`));
  return () => expect(output).toEqual([]);
}

type LocalApiCalls = { calendar: number; demo: number; sync: number };
type CallBounds = { [key in keyof LocalApiCalls]: readonly [number, number] };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isAllowedSyncMutation(value: unknown) {
  if (!isObject(value)) return false;
  const envelope = ["baseRevision", "idempotencyKey", "localRevision", "operation", "payload", "recordId", "recordType", "updatedAt"];
  if (!hasOnlyKeys(value, envelope) || Object.keys(value).length !== envelope.length) return false;
  if (value.recordType !== "settings" && value.recordType !== "expenses") return false;
  if (value.operation !== "upsert" && value.operation !== "delete") return false;
  if (typeof value.idempotencyKey !== "string" || typeof value.recordId !== "string" || typeof value.updatedAt !== "string") return false;
  if (![value.baseRevision, value.localRevision].every((revision) => Number.isInteger(revision) && Number(revision) >= 0)) return false;
  if (!isObject(value.payload)) return false;
  const payloadKeys = value.recordType === "settings"
    ? ["ciphertext", "encryptionVersion", "initializationVector", "invoicePrefix", "kdfParameters", "profile", "salt"]
    : ["allowablePercentage", "amountPence", "categoryKey", "customCategoryId", "distanceMiles", "expenseDate", "expenseKind", "isDemo", "journeyDestination", "journeyOrigin", "linkedSessionId", "mileageRatePence", "mtdCategory", "needsAccountantReview", "notes", "practiceId", "receiptMimeType", "receiptObjectKey", "receiptOriginalName", "receiptSizeBytes", "receiptSyncStatus", "reimbursedByPractice", "supplierDescription"];
  return hasOnlyKeys(value.payload, payloadKeys);
}

async function installCleanLocalApi(page: Page, expectedCalls: CallBounds) {
  const calls: LocalApiCalls = { calendar: 0, demo: 0, sync: 0 };
  const failures: string[] = [];
  const rejectedRoutes: string[] = [];
  const reject = async (route: Route, message: string) => {
    failures.push(message);
    await route.abort("failed");
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/demo-data") {
      calls.demo += 1;
      if (request.method() !== "POST" || url.search !== "" || request.postData() !== null) return reject(route, `demo ${request.method()} ${url.pathname}${url.search}`);
      await route.fulfill({ body: JSON.stringify({ demoRecordCount: 0, seeded: false }), contentType: "application/json" });
      return;
    }
    if (url.pathname === "/api/sync") {
      let body: unknown = null;
      try { body = request.postDataJSON(); } catch { /* fail closed below */ }
      calls.sync += 1;
      if (!isObject(body) || request.method() !== "POST" || url.search !== "" || !hasOnlyKeys(body, ["cursor", "mutations"]) || Object.keys(body).length !== 2 || !(body.cursor === null || typeof body.cursor === "string") || !Array.isArray(body.mutations) || !body.mutations.every(isAllowedSyncMutation)) return reject(route, `sync ${request.method()} ${url.pathname}${url.search}`);
      await route.fulfill({
        body: JSON.stringify({
          applied: body.mutations.filter((mutation) => mutation.operation === "upsert").map((mutation) => ({
            data: mutation.payload, mutationId: mutation.idempotencyKey, recordId: mutation.recordId,
            recordType: mutation.recordType, serverRevision: mutation.localRevision, updatedAt: mutation.updatedAt,
          })),
          conflicts: [], nextCursor: null, pulled: [],
        }),
        contentType: "application/json",
      });
      return;
    }
    if (url.pathname === "/api/google-calendar/sync") {
      calls.calendar += 1;
      if (request.method() !== "POST" || url.search !== "" || request.postData() !== null) return reject(route, `calendar ${request.method()} ${url.pathname}${url.search}`);
      await route.fulfill({ body: JSON.stringify({ state: "disabled", pendingCount: 0, lastSyncAt: null, nextRetryAt: null }), contentType: "application/json" });
      return;
    }
    rejectedRoutes.push(`${request.method()} ${url.pathname}${url.search}`);
    await route.abort("failed");
  });
  return {
    assertCalls() {
      expect(failures).toEqual([]);
      for (const key of Object.keys(calls) as Array<keyof LocalApiCalls>) {
        expect(calls[key], `${key} call count`).toBeGreaterThanOrEqual(expectedCalls[key][0]);
        expect(calls[key], `${key} call count`).toBeLessThanOrEqual(expectedCalls[key][1]);
      }
      return calls;
    },
    assertRejectedRoutes(expected: string[]) {
      expect(rejectedRoutes).toEqual(expected);
    },
  };
}

async function expectFilenameEllipsis(page: Page, filename: string, width: number) {
  await page.setViewportSize({ width, height: 844 });
  const form = activeExpenseForm(page);
  await expect(form, `active expense form is unique at ${width}px`).toHaveCount(1);
  const geometry = await form.evaluate((activeForm, expectedFilename) => {
    const matches = [...activeForm.querySelectorAll<HTMLElement>(
      ".expense-receipt-swipe__filename, .expense-form__receipt-name",
    )]
      .filter((element) => element.textContent === expectedFilename && element.getClientRects().length > 0);
    if (matches.length !== 1) return { matches: matches.length };
    const style = getComputedStyle(matches[0]);
    return {
      clipped: matches[0].scrollWidth > matches[0].clientWidth,
      filename: matches[0].textContent,
      matches: matches.length,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  }, filename);
  expect(geometry).toEqual({
    clipped: true,
    filename,
    matches: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
}

async function expectReceiptAttached(page: Page, filename: string) {
  const form = activeExpenseForm(page);
  await expect(form, "active expense form is unique for attached receipt").toHaveCount(1);
  await expect(form.getByText("Receipt attached", { exact: true })).toHaveCount(1);
  await expect(form.getByText(filename, { exact: true })).toHaveCount(1);
}

async function dragReceiptSurface(page: Page, deltaX: number, deltaY: number, fromRight = false) {
  const surface = receiptSurface(page);
  await surface.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  const startX = fromRight ? box!.x + box!.width - 24 : box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
}

async function beginReceiptPull(page: Page, distance: number) {
  const surface = receiptSurface(page);
  await surface.scrollIntoViewIfNeeded();
  await surface.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const box = await surface.boundingBox();
  if (!box) throw new Error("Expected visible receipt surface");
  const startX = box.x + box.width - 18;
  const y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX - distance, y + 2, { steps: 8 });
  return { box, startX, y };
}

async function finishReceiptPull(page: Page) {
  await page.mouse.up();
}

async function expectReceiptRubberBandPull(page: Page, width: number) {
  const row = editableReceiptRow(page);
  const surface = receiptSurface(page);
  await beginReceiptPull(page, 330);
  await expect.poll(
    () => surface.getAttribute("data-dragging"),
    { message: `receipt overswipe is active at ${width}px` },
  ).toBe("true");

  const overswipe = await row.evaluate((element) => {
    const surfaceElement = element.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
    const actions = [...element.querySelectorAll<HTMLElement>(".expense-receipt-swipe__action")];
    const icons = [...element.querySelectorAll<HTMLElement>(".expense-receipt-swipe__action-icon")];
    if (!surfaceElement || actions.length !== 3 || icons.length !== 3) {
      throw new Error("Expected three receipt actions during overswipe");
    }
    const surfaceMatrix = new DOMMatrixReadOnly(getComputedStyle(surfaceElement).transform);
    const dangerTarget = actions[2].getBoundingClientRect();
    const dangerIcon = icons[2].getBoundingClientRect();
    const dangerDecoration = getComputedStyle(icons[2], "::before");
    return {
      actionProgress: actions.map((action) => Number(
        action.style.getPropertyValue("--expense-receipt-action-progress"),
      )),
      actionTargets: actions.map((action) => {
        const box = action.getBoundingClientRect();
        return { height: box.height, width: box.width };
      }),
      iconWidths: icons.map((icon) => icon.getBoundingClientRect().width),
      dangerVisual: {
        decorationPointerEvents: dangerDecoration.pointerEvents,
        decorationWidth: Number.parseFloat(dangerDecoration.width),
        iconLeft: dangerIcon.left,
        iconRight: dangerIcon.right,
        targetLeft: dangerTarget.left,
        targetRight: dangerTarget.right,
        targetWidth: dangerTarget.width,
      },
      offset: surfaceMatrix.m41,
      resistedDistance: Number.parseFloat(
        element.style.getPropertyValue("--expense-receipt-overswipe"),
      ),
      stretch: Number(element.style.getPropertyValue("--expense-receipt-remove-stretch")),
    };
  });

  expect(overswipe.offset, `overswipe moves beyond the normal tray at ${width}px`).toBeLessThan(-234);
  expect(overswipe.offset, `overswipe remains resistance-bounded at ${width}px`).toBeGreaterThanOrEqual(-262);
  expect(overswipe.resistedDistance, `overswipe resistance is visible at ${width}px`).toBeGreaterThan(0);
  expect(overswipe.resistedDistance, `overswipe resistance is bounded at ${width}px`).toBeLessThanOrEqual(28);
  expect(overswipe.stretch, `Remove stretches at ${width}px`).toBe(1);
  expect(overswipe.actionProgress).toEqual([1, 1, 1]);
  expect(overswipe.iconWidths[2], `Remove keeps a fixed hit box at ${width}px`).toBeCloseTo(44, 1);
  expect(
    overswipe.dangerVisual.iconLeft,
    `Remove icon stays inside its lane at ${width}px`,
  ).toBeGreaterThanOrEqual(overswipe.dangerVisual.targetLeft);
  expect(
    overswipe.dangerVisual.iconRight,
    `Remove icon stays inside its lane at ${width}px`,
  ).toBeLessThanOrEqual(overswipe.dangerVisual.targetRight);
  expect(
    overswipe.dangerVisual.decorationWidth,
    `Remove decoration stays inside its lane at ${width}px`,
  ).toBeLessThanOrEqual(overswipe.dangerVisual.targetWidth);
  expect(
    overswipe.dangerVisual.decorationPointerEvents,
    `Remove decoration cannot intercept taps at ${width}px`,
  ).toBe("none");
  for (const target of overswipe.actionTargets) {
    expect(target.width, `overswipe action target width at ${width}px`).toBeGreaterThanOrEqual(44);
    expect(target.height, `overswipe action target height at ${width}px`).toBeGreaterThanOrEqual(44);
  }
  await expect(row.getByText("Receipt attached", { exact: true })).toBeAttached();
  await expect(row.getByText("Receipt will be removed when you save.", { exact: true })).toHaveCount(0);

  await finishReceiptPull(page);
  await expect(receiptOptions(page)).toHaveAttribute("aria-expanded", "true");
  await expect.poll(
    () => row.evaluate((element) => Number(
      element.style.getPropertyValue("--expense-receipt-remove-stretch"),
    )),
    { message: `Remove returns to its settled width at ${width}px` },
  ).toBe(0);
  await expect.poll(
    () => row.locator(".expense-receipt-swipe__action--danger .expense-receipt-swipe__action-icon")
      .evaluate((element) => element.getBoundingClientRect().width),
    { message: `Remove returns to a circle at ${width}px` },
  ).toBeLessThanOrEqual(44.1);
  await expect(row.getByText("Receipt will be removed when you save.", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expectReceiptTrayClosed(page);
}

async function expectReceiptTrayClosed(page: Page) {
  const row = editableReceiptRow(page);
  const surface = receiptSurface(page);
  const tray = row.locator(".expense-receipt-swipe__tray");
  await expect(row.getByText("Swipe left for options", { exact: true })).toBeVisible();
  await expect(receiptOptions(page)).toBeVisible();
  await expect(receiptOptions(page)).toHaveAttribute("aria-expanded", "false");
  await expect(tray).toHaveAttribute("aria-hidden", "true");
  await expect(tray).toHaveAttribute("data-revealed", "false");
  await expect.poll(
    () => surface.evaluate((element) => {
      const transform = getComputedStyle(element).transform;
      if (transform === "none") return 0;
      return Number(new DOMMatrixReadOnly(transform).m41.toFixed(1));
    }),
    { message: "receipt surface visibly settles closed" },
  ).toBe(0);
  await expect(receiptTrayActions(page)).toHaveCount(3);
  expect(await receiptTrayActions(page).evaluateAll((actions) => actions.map((action) => action.tabIndex))).toEqual([-1, -1, -1]);
  await expect(row.getByRole("button", { name: "View", exact: true })).toHaveCount(0);
}

async function swipeReceiptLeft(page: Page) {
  const surface = receiptSurface(page);
  await surface.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width - 24, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 40, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(receiptOptions(page)).toHaveAttribute("aria-expanded", "true");
}

async function expectExactReceiptTray(page: Page) {
  await expect(receiptTrayActions(page)).toHaveCount(3);
  expect(await receiptTrayActions(page).allTextContents()).toEqual(["↗View", "↻Change", "⌫Remove"]);
}

async function expectCurrentSaveAboveNavigation(page: Page, save: Locator, label: string) {
  await save.scrollIntoViewIfNeeded();
  await expect(save, `${label} is in the viewport`).toBeInViewport();
  const geometry = await save.evaluate((element) => {
    const navigation = document.querySelector<HTMLElement>(".app-navigation");
    if (!navigation) return null;
    const actionBox = element.getBoundingClientRect();
    const navigationBox = navigation.getBoundingClientRect();
    return {
      actionBottom: actionBox.bottom,
      actionHeight: actionBox.height,
      actionLeft: actionBox.left,
      actionRight: actionBox.right,
      navigationTop: navigationBox.top,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry!.actionHeight).toBeGreaterThanOrEqual(44);
  expect(geometry!.actionLeft).toBeGreaterThanOrEqual(0);
  expect(geometry!.actionRight).toBeLessThanOrEqual(geometry!.viewportWidth);
  expect(geometry!.actionBottom).toBeLessThanOrEqual(geometry!.navigationTop + 1);
}

async function expectDocumentScrollsFromReceipt(page: Page, width: number) {
  const surface = receiptSurface(page);
  await expect.poll(
    () => surface.evaluate((element) => {
      const row = element.closest<HTMLElement>(".expense-receipt-swipe");
      return row
        ? Math.abs(element.getBoundingClientRect().left - row.getBoundingClientRect().left) < 1
        : false;
    }),
    { message: `receipt surface has returned to its closed position at ${width}px` },
  ).toBe(true);
  await surface.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const box = await surface.boundingBox();
  expect(box, `receipt surface has geometry at ${width}px`).not.toBeNull();

  const before = await page.evaluate(() => ({
    maximum: document.documentElement.scrollHeight - window.innerHeight,
    scrollY: window.scrollY,
  }));
  expect(before.maximum, `document can scroll at ${width}px`).toBeGreaterThan(0);
  const deltaY = before.maximum - before.scrollY >= 120 ? 180 : -180;
  const pointerX = box!.x + box!.width / 2;
  const pointerY = box!.y + box!.height / 2;
  await page.mouse.move(pointerX, pointerY);
  expect(await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.closest('[data-testid="receipt-attachment-row"]') !== null
  ), { x: pointerX, y: pointerY }), `pointer is over receipt row at ${width}px`).toBe(true);
  await page.mouse.wheel(0, deltaY);

  await expect.poll(
    () => page.evaluate(() => window.scrollY),
    { message: `document scroll changes from receipt row at ${width}px` },
  ).not.toBe(before.scrollY);
}

async function expectKeyboardReceiptPathAtWidth(page: Page, width: number) {
  const options = receiptOptions(page);
  await options.focus();
  await expect(options, `Receipt options has focus at ${width}px`).toBeFocused();
  await page.keyboard.press("Enter");
  await expectExactReceiptTray(page);

  const [view, change, remove] = await receiptTrayActions(page).all();
  await expect(view, `keyboard focus starts on View at ${width}px`).toBeFocused();
  const focusGeometry = await view.evaluate((element) => {
    const row = element.closest<HTMLElement>(".expense-receipt-swipe");
    if (!row) return null;
    const actionBox = element.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      contained: actionBox.left >= rowBox.left && actionBox.right <= rowBox.right
        && actionBox.top >= rowBox.top && actionBox.bottom <= rowBox.bottom,
      outlineOffset: style.outlineOffset,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(focusGeometry).toEqual({
    contained: true,
    outlineOffset: "-3px",
    outlineStyle: "solid",
    outlineWidth: "3px",
  });

  await page.keyboard.press("Tab");
  await expect(change, `keyboard focus reaches Change at ${width}px`).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(remove, `keyboard focus reaches Remove at ${width}px`).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(options, `Escape restores Options focus at ${width}px`).toBeFocused();
  await expectReceiptTrayClosed(page);
}

async function expectReducedMotionReceiptPath(page: Page, width: number) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await receiptOptions(page).click();
  await expectExactReceiptTray(page);
  const settled = await editableReceiptRow(page).evaluate((element) => {
    const icons = [...element.querySelectorAll<HTMLElement>(".expense-receipt-swipe__action-icon")];
    const labels = [...element.querySelectorAll<HTMLElement>(".expense-receipt-swipe__action-label")];
    return {
      icons: icons.map((icon) => ({
        opacity: getComputedStyle(icon).opacity,
        transform: getComputedStyle(icon).transform,
        transition: getComputedStyle(icon).transitionDuration,
        width: icon.getBoundingClientRect().width,
      })),
      labels: labels.map((label) => ({
        opacity: getComputedStyle(label).opacity,
        transform: getComputedStyle(label).transform,
        transition: getComputedStyle(label).transitionDuration,
      })),
    };
  });
  expect(settled.icons).toHaveLength(3);
  expect(settled.labels).toHaveLength(3);
  for (const icon of settled.icons) {
    expect(icon.opacity, `reduced-motion icon opacity at ${width}px`).toBe("1");
    expect(icon.transform, `reduced-motion icon transform at ${width}px`).toBe("none");
    expect(icon.transition, `reduced-motion icon transition at ${width}px`).toBe("0s");
    expect(icon.width, `reduced-motion icon width at ${width}px`).toBeCloseTo(44, 1);
  }
  for (const label of settled.labels) {
    expect(label.opacity, `reduced-motion label opacity at ${width}px`).toBe("1");
    expect(label.transform, `reduced-motion label transform at ${width}px`).toBe("none");
    expect(label.transition, `reduced-motion label transition at ${width}px`).toBe("0s");
  }
  await page.keyboard.press("Escape");
  await expectReceiptTrayClosed(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

async function expectEditableReceiptInteractionAtWidth(
  page: Page,
  filename: string,
  save: Locator,
  width: 320 | 375 | 390,
  persistedReceipt = false,
) {
  await page.setViewportSize({ width, height: 844 });
  const row = editableReceiptRow(page);
  const surface = receiptSurface(page);
  const options = receiptOptions(page);
  await row.scrollIntoViewIfNeeded();
  await expect(row, `receipt row is visible at ${width}px`).toBeVisible();
  await expect(surface, `receipt surface is visible at ${width}px`).toBeVisible();
  await expect(options, `receipt Options is visible at ${width}px`).toBeVisible();
  await expectReceiptTrayClosed(page);
  await expectFilenameEllipsis(page, filename, width);

  const closedGeometry = await row.evaluate((element) => {
    const surfaceElement = element.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
    const optionsElement = element.querySelector<HTMLElement>(".expense-receipt-swipe__options");
    if (!surfaceElement || !optionsElement) return null;
    const rowBox = element.getBoundingClientRect();
    const optionsBox = optionsElement.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    return {
      documentContained: document.documentElement.scrollWidth === viewportWidth,
      optionsContained: optionsBox.left >= 0 && optionsBox.right <= viewportWidth,
      optionsHeight: optionsBox.height,
      optionsWidth: optionsBox.width,
      rowContained: rowBox.left >= 0 && rowBox.right <= viewportWidth,
      touchAction: getComputedStyle(surfaceElement).touchAction,
    };
  });
  expect(closedGeometry).not.toBeNull();
  expect(closedGeometry!.documentContained).toBe(true);
  expect(closedGeometry!.optionsContained).toBe(true);
  expect(closedGeometry!.optionsHeight).toBeGreaterThanOrEqual(44);
  expect(Number(closedGeometry!.optionsWidth.toFixed(3))).toBeGreaterThanOrEqual(44);
  expect(closedGeometry!.rowContained).toBe(true);
  expect(closedGeometry!.touchAction).toBe("pan-y");

  await beginReceiptPull(page, 82);
  await expect.poll(
    () => receiptSurface(page).getAttribute("data-dragging"),
    { message: `receipt drag is in progress at ${width}px` },
  ).toBe("true");
  const duringPull = await row.evaluate((element) => {
    const surfaceElement = element.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
    const tray = element.querySelector<HTMLElement>(".expense-receipt-swipe__tray");
    const actions = [...element.querySelectorAll<HTMLElement>(".expense-receipt-swipe__action")];
    if (!surfaceElement || !tray || actions.length !== 3) {
      throw new Error("Expected receipt swipe geometry");
    }
    const surfaceRect = surfaceElement.getBoundingClientRect();
    const trayRect = tray.getBoundingClientRect();
    return {
      actionLabels: actions.map((action) => action.textContent?.trim()),
      actionProgress: actions.map((action) => Number(
        action.style.getPropertyValue("--expense-receipt-action-progress"),
      )),
      actionScales: actions.map((action) => {
        const icon = action.querySelector<HTMLElement>(".expense-receipt-swipe__action-icon");
        return icon ? new DOMMatrixReadOnly(getComputedStyle(icon).transform).a : 0;
      }),
      actionTargets: actions.map((action) => {
        const box = action.getBoundingClientRect();
        return { height: box.height, width: box.width };
      }),
      dragging: surfaceElement.dataset.dragging,
      revealedPixels: surfaceRect.right < trayRect.right ? trayRect.right - surfaceRect.right : 0,
      surfaceTransform: getComputedStyle(surfaceElement).transform,
    };
  });
  expect(duringPull.dragging).toBe("true");
  expect(duringPull.revealedPixels).toBeGreaterThan(20);
  expect(duringPull.actionLabels).toEqual(["↗View", "↻Change", "⌫Remove"]);
  expect(duringPull.actionProgress[0]).toBe(0);
  expect(duringPull.actionProgress[1]).toBeGreaterThan(0);
  expect(duringPull.actionProgress[1]).toBeLessThan(1);
  expect(duringPull.actionProgress[2]).toBe(1);
  expect(duringPull.actionScales[0]).toBeLessThan(duringPull.actionScales[1]);
  expect(duringPull.actionScales[1]).toBeLessThan(duringPull.actionScales[2]);
  for (const target of duringPull.actionTargets) {
    expect(target.width, `partial action target width at ${width}px`).toBeGreaterThanOrEqual(44);
    expect(target.height, `partial action target height at ${width}px`).toBeGreaterThanOrEqual(44);
  }
  expect(duringPull.surfaceTransform).not.toBe("none");
  await finishReceiptPull(page);

  await expect(options).toHaveAttribute("aria-expanded", "true");
  await expect(receiptTrayActions(page)).toHaveCount(3);
  for (const name of ["View", "Change", "Remove"]) {
    const action = row.getByRole("button", { name, exact: true });
    await expect(action, `${name} is visible at ${width}px`).toBeVisible();
    await expect(action, `${name} is in the viewport at ${width}px`).toBeInViewport();
    const box = await action.boundingBox();
    expect(box, `${name} exists at ${width}px`).not.toBeNull();
    expect(box!.width, `${name} width at ${width}px`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${name} height at ${width}px`).toBeGreaterThanOrEqual(44);
    expect(box!.x, `${name} left at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${name} right at ${width}px`).toBeLessThanOrEqual(width);
    expect(box!.y, `${name} top at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, `${name} bottom at ${width}px`).toBeLessThanOrEqual(844);
  }
  await page.keyboard.press("Escape");
  await expectReceiptTrayClosed(page);

  await expectDocumentScrollsFromReceipt(page, width);
  await expectKeyboardReceiptPathAtWidth(page, width);
  if (width === 390) await expectReducedMotionReceiptPath(page, width);

  await expectCurrentSaveAboveNavigation(page, save, `closed receipt save at ${width}px`);
  await row.scrollIntoViewIfNeeded();
  await dragReceiptSurface(page, -24, 4);
  await expectReceiptTrayClosed(page);
  await dragReceiptSurface(page, -12, 92);
  await expectReceiptTrayClosed(page);

  await expectReceiptRubberBandPull(page, width);

  await swipeReceiptLeft(page);
  await expectExactReceiptTray(page);
  const openGeometry = await receiptTrayActions(page).evaluateAll((actions) => {
    const viewportWidth = document.documentElement.clientWidth;
    const surface = actions[0]?.closest(".expense-receipt-swipe")
      ?.querySelector<HTMLElement>(".expense-receipt-swipe__surface");
    return {
      actions: actions.map((action) => {
        const box = action.getBoundingClientRect();
        return {
          contained: box.left >= 0 && box.right <= viewportWidth,
          height: box.height,
          left: box.left,
          right: box.right,
          width: box.width,
        };
      }),
      documentContained: document.documentElement.scrollWidth === viewportWidth,
      surfaceTransitionDuration: surface ? getComputedStyle(surface).transitionDuration : "",
    };
  });
  expect(openGeometry.documentContained).toBe(true);
  expect(openGeometry.actions).toHaveLength(3);
  for (const action of openGeometry.actions) {
    expect(action.contained).toBe(true);
    expect(action.width).toBeGreaterThanOrEqual(44);
    expect(action.height).toBeGreaterThanOrEqual(44);
  }
  expect(openGeometry.actions[0].right).toBeLessThanOrEqual(openGeometry.actions[1].left);
  expect(openGeometry.actions[1].right).toBeLessThanOrEqual(openGeometry.actions[2].left);
  expect(openGeometry.surfaceTransitionDuration).toContain("0.24s");
  await expectCurrentSaveAboveNavigation(page, save, `open receipt save at ${width}px`);
  await expect(receiptOptions(page)).toHaveAttribute("aria-expanded", "true");
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  if (persistedReceipt) {
    await expect(row.getByText("Receipt will be removed when you save.", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Undo", exact: true }).click();
  } else {
    await expect(row.getByText("No receipt added", { exact: true })).toBeVisible();
    await activeExpenseForm(page).getByLabel("Add receipt", { exact: true }).setInputFiles({
      buffer: Buffer.from("fictional tidy expense receipt"),
      mimeType: "application/pdf",
      name: filename,
    });
  }
  await expect(row.getByText("Receipt attached", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expectReceiptTrayClosed(page);
}

async function expectActionsAboveFixedNavigation(
  page: Page,
  actions: TidyTarget[],
  widths = [320, 375, 390],
) {
  expect(actions.length).toBeGreaterThan(0);
  const navigation = page.locator(".app-navigation");
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await expect(navigation, `bottom navigation is unique at ${width}px`).toHaveCount(1);
    await expect(navigation, `bottom navigation is visible at ${width}px`).toBeVisible();
    for (const action of actions) {
      await expect(action.locator, `${action.name} is unique at ${width}px`).toHaveCount(1);
      await expect(action.locator, `${action.name} is visible at ${width}px`).toBeVisible();
      await action.locator.scrollIntoViewIfNeeded();
      await expect(action.locator, `${action.name} is in the viewport at ${width}px`).toBeInViewport();
      const geometry = await action.locator.evaluate((element) => {
        const navigationElements = document.querySelectorAll<HTMLElement>(".app-navigation");
        if (navigationElements.length !== 1) return null;
        const actionBox = element.getBoundingClientRect();
        const navigationBox = navigationElements[0].getBoundingClientRect();
        return {
          actionBottom: actionBox.bottom,
          actionHeight: actionBox.height,
          actionLeft: actionBox.left,
          actionRight: actionBox.right,
          actionTop: actionBox.top,
          actionWidth: actionBox.width,
          navigationTop: navigationBox.top,
          viewportWidth: document.documentElement.clientWidth,
        };
      });
      expect(geometry).not.toBeNull();
      expect(geometry!.actionWidth).toBeGreaterThanOrEqual(44);
      expect(geometry!.actionHeight).toBeGreaterThanOrEqual(44);
      expect(geometry!.actionLeft).toBeGreaterThanOrEqual(0);
      expect(geometry!.actionRight).toBeLessThanOrEqual(geometry!.viewportWidth);
      expect(geometry!.actionTop).toBeGreaterThanOrEqual(0);
      expect(geometry!.actionBottom).toBeLessThanOrEqual(geometry!.navigationTop + 1);
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("locum-manager:install-guide-dismissed", "true"));
});

async function seedRepositoryBackedExpense(page: Page, expenseId: string, receiptName: string) {
  await page.goto("/expenses");
  await waitForDatabase(page);
  await page.evaluate(async ({ expenseId: id, ownerId, receiptName: name }) => {
    const open = indexedDB.open("locum-manager");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const transaction = database.transaction("expenses", "readwrite");
    transaction.objectStore("expenses").put({
      data: {
        allowablePercentage: 100, amountPence: 1975, categoryKey: "home_office",
        customCategoryId: null, expenseDate: "2026-08-11", expenseKind: "standard",
        isDemo: false, journeyDestination: null, journeyOrigin: null, linkedSessionId: null,
        mileageRatePence: null, distanceMiles: null, mtdCategory: "premises_costs",
        needsAccountantReview: false, notes: null, practiceId: null,
        receiptMimeType: "application/pdf", receiptObjectKey: `${ownerId}/${id}/${name}`,
        receiptOriginalName: name, receiptSizeBytes: 42, receiptSyncStatus: "uploaded",
        reimbursedByPractice: false, supplierDescription: "Fictional repository expense",
      },
      deletedAt: null, id, localRevision: 1, ownerId, recordType: "expenses",
      serverRevision: 1, syncState: "synced", updatedAt: "2026-08-11T12:00:00.000Z",
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { expenseId, ownerId: OWNER, receiptName });
}

test("tidy expense forms stay usable at supported mobile widths", async ({ page }) => {
  test.slow();
  const longReceiptName =
    "fictional-receipt-with-a-deliberately-long-name-for-mobile-layout-verification-2026.pdf";
  const repositoryExpenseId = "repository-backed-receipt-expense";
  const localApi = await installCleanLocalApi(page, {
    calendar: [11, 11], demo: [6, 6], sync: [12, 12],
  });
  await chooseProfession(page, "GP");
  const unknownApiProbe = await page.evaluate(async () => {
    try {
      await fetch("/api/fictional-expense-route-probe", { method: "POST" });
      return "fulfilled";
    } catch {
      return "rejected";
    }
  });
  expect(unknownApiProbe).toBe("rejected");
  localApi.assertRejectedRoutes(["POST /api/fictional-expense-route-probe"]);
  const expectCleanConsole = captureConsole(page);

  await page.goto("/expenses/new/manual");
  await expect(page.getByRole("heading", { name: "Add this expense" })).toBeVisible();
  await expect(activeExpenseForm(page)).toHaveCount(1);
  await expect(activeExpenseForm(page).getByText("No receipt added", { exact: true })).toHaveCount(1);
  const manualTargets = primaryExpenseTargets(page);
  expect(manualTargets.length).toBe(8);
  const manualAddReceipt = editableReceiptRow(page).getByRole("button", { name: "Add receipt", exact: true });
  await expectExactActionTargets(page, [{ locator: manualAddReceipt, name: "manual add receipt" }]);
  await activeExpenseForm(page).getByLabel("Add receipt", { exact: true }).setInputFiles({
    buffer: Buffer.from("fictional tidy expense receipt"),
    mimeType: "application/pdf",
    name: longReceiptName,
  });
  await expectReceiptAttached(page, longReceiptName);
  await expectReceiptTrayClosed(page);
  await expectFilenameEllipsis(page, longReceiptName, 390);
  const manualMoreOptions = activeExpenseForm(page).locator(".record-form__advanced");
  await expect(manualMoreOptions).not.toHaveAttribute("open", "");
  await expectTidyExpenseForm(page, manualTargets);
  const manualReceiptActions = [
    { locator: activeExpenseForm(page).getByRole("button", { name: /^View receipt, Receipt attached,/ }), name: "manual receipt summary" },
    { locator: receiptOptions(page), name: "manual receipt options" },
  ];
  expect(manualReceiptActions.length).toBe(2);
  await expectExactActionTargets(page, manualReceiptActions);
  const manualActions = [
    { locator: activeExpenseForm(page).getByRole("button", { name: "Save expense" }), name: "manual save" },
  ];
  await expectActionsAboveFixedNavigation(page, manualActions);
  for (const width of [320, 375, 390]) {
    await expectEditableReceiptInteractionAtWidth(
      page,
      longReceiptName,
      activeExpenseForm(page).getByRole("button", { name: "Save expense" }),
      width as 320 | 375 | 390,
    );
  }

  await activeExpenseForm(page).getByLabel("What did you buy?").fill("Fictional mobile validation");
  await activeExpenseForm(page).getByLabel("How much did it cost?", { exact: true }).fill("19.75");
  await activeExpenseForm(page).getByLabel("What type of expense is it?", { exact: true }).selectOption("home_office");
  await activeExpenseForm(page).getByText("More details", { exact: true }).click();
  await activeExpenseForm(page).getByLabel("Business-use percentage").fill("");
  await activeExpenseForm(page).getByText("More details", { exact: true }).click();
  await activeExpenseForm(page).getByRole("button", { name: "Save expense" }).click();
  await expect(manualMoreOptions).toHaveAttribute("open", "");
  const invalidBusinessUse = activeExpenseForm(page).getByLabel("Business-use percentage");
  await expect(invalidBusinessUse).toBeFocused();
  const focusIndicator = await invalidBusinessUse.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow !== "none",
      outline: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
    };
  });
  expect(focusIndicator.outline || focusIndicator.boxShadow).toBe(true);
  await expectActionsAboveFixedNavigation(page, manualActions);

  await seedRepositoryBackedExpense(page, repositoryExpenseId, longReceiptName);
  await page.addInitScript(() => { window.open = () => null; });
  let receiptReads = 0;
  const receiptFailures: string[] = [];
  // This later, narrower route wins over the local `/api/**` catch-all, so the
  // receipt request has one strict owner and unknown expense paths still abort here.
  await page.route("**/api/expenses/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    receiptReads += 1;
    if (
      request.method() !== "GET" ||
      url.pathname !== `/api/expenses/${repositoryExpenseId}/receipt` ||
      url.search !== "" ||
      request.postData() !== null ||
      receiptReads !== 1
    ) {
      receiptFailures.push(`${request.method()} ${url.pathname}${url.search}`);
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ url: "https://receipt.invalid/fictional-signed-receipt.pdf" }),
      contentType: "application/json",
    });
  });

  await page.goto(`/expenses/${repositoryExpenseId}`);
  await expect(page.getByRole("heading", { name: "Check this expense" })).toBeVisible();
  await expect(activeExpenseForm(page)).toHaveCount(1);
  await expect(page.getByText(/Step \d of 3:/)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Steps" })).toHaveCount(0);
  await expectReceiptAttached(page, longReceiptName);
  await expect(activeExpenseForm(page).getByRole("button", { name: /^View receipt, Receipt attached,/ })).toHaveCount(1);
  await expectReceiptTrayClosed(page);
  await expect(activeExpenseForm(page).getByLabel("Change receipt")).toBeAttached();
  await expect(activeExpenseForm(page).getByLabel("Remove existing receipt").locator("xpath=ancestor::details"))
    .not.toHaveAttribute("open", "");
  await expect(activeExpenseForm(page).getByRole("button", { name: "Save changes" })).toBeVisible();
  const editTargets = primaryExpenseTargets(page, "Save changes");
  expect(editTargets.length).toBe(8);
  await expectTidyExpenseForm(page, editTargets);
  const editReceiptActions = [
    { locator: activeExpenseForm(page).getByRole("button", { name: /^View receipt, Receipt attached,/ }), name: "edit receipt summary" },
    { locator: receiptOptions(page), name: "edit receipt options" },
    { locator: activeExpenseForm(page).getByRole("button", { name: "Delete expense" }), name: "edit delete" },
  ];
  expect(editReceiptActions.length).toBe(3);
  await expectExactActionTargets(page, editReceiptActions);
  const editActions = [
    { locator: activeExpenseForm(page).getByRole("button", { name: "Save changes" }), name: "edit save" },
    { locator: activeExpenseForm(page).getByRole("button", { name: "Delete expense" }), name: "edit delete" },
  ];
  await expectActionsAboveFixedNavigation(page, editActions);
  for (const width of [320, 375, 390]) {
    await expectEditableReceiptInteractionAtWidth(
      page,
      longReceiptName,
      activeExpenseForm(page).getByRole("button", { name: "Save changes" }),
      width as 320 | 375 | 390,
      true,
    );
  }
  expect(receiptReads).toBe(0);
  const exactEditUrl = page.url();
  await receiptOptions(page).click();
  await expectExactReceiptTray(page);
  await editableReceiptRow(page).getByRole("button", { name: "View", exact: true }).click();
  await expect.poll(() => receiptReads).toBe(1);
  await expect(page).toHaveURL(exactEditUrl);
  expect(receiptFailures).toEqual([]);
  await page.keyboard.press("Escape");
  await expectReceiptTrayClosed(page);

  const signedUrlPersistence = await page.evaluate(async (sentinel) => {
    const databaseResult = await new Promise<string>((resolve, reject) => {
      const request = indexedDB.open("locum-manager");
      request.onsuccess = () => {
        const database = request.result;
        const stores = [...database.objectStoreNames];
        if (stores.length === 0) { database.close(); resolve(""); return; }
        const transaction = database.transaction(stores, "readonly");
        const rows: unknown[] = [];
        for (const store of stores) {
          const getAll = transaction.objectStore(store).getAll();
          getAll.onsuccess = () => rows.push(...getAll.result);
        }
        transaction.oncomplete = () => { database.close(); resolve(JSON.stringify(rows)); };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
    const cacheEntries: string[] = [];
    for (const cacheName of await caches.keys()) {
      cacheEntries.push(cacheName);
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        cacheEntries.push(request.url);
        const response = await cache.match(request);
        if (response) {
          cacheEntries.push(
            response.url,
            String(response.redirected),
            String(response.status),
            response.statusText,
            response.type,
            JSON.stringify([...response.headers]),
            await response.clone().text(),
          );
        }
      }
    }
    return {
      cache: cacheEntries.join("\n").includes(sentinel),
      indexedDb: databaseResult.includes(sentinel),
      localStorage: JSON.stringify({ ...localStorage }).includes(sentinel),
      sessionStorage: JSON.stringify({ ...sessionStorage }).includes(sentinel),
    };
  }, "https://receipt.invalid/fictional-signed-receipt.pdf");
  expect(signedUrlPersistence).toEqual({ cache: false, indexedDb: false, localStorage: false, sessionStorage: false });

  await receiptOptions(page).click();
  await expectExactReceiptTray(page);
  await editableReceiptRow(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(activeExpenseForm(page).getByText("Receipt will be removed when you save.", { exact: true })).toBeVisible();
  await expect(activeExpenseForm(page).getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await expect(activeExpenseForm(page).getByLabel("Remove existing receipt")).toBeChecked();
  await activeExpenseForm(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expectReceiptAttached(page, longReceiptName);
  await expectReceiptTrayClosed(page);
  await expect(activeExpenseForm(page).getByLabel("Remove existing receipt")).not.toBeChecked();
  expect(receiptReads).toBe(1);

  await activeExpenseForm(page).getByText("More details", { exact: true }).click();
  await expectTidyExpenseForm(page, [
    ...editTargets,
    ...advancedExpenseTargets(page),
    { locator: activeExpenseForm(page).locator(".record-form__check").filter({ hasText: "Remove existing receipt" }), name: "remove receipt" },
    { locator: activeExpenseForm(page).getByRole("button", { name: "Delete expense" }), name: "delete" },
  ]);
  await expectActionsAboveFixedNavigation(page, editActions);

  await page.goto("/expenses/new/scan");
  await page.getByLabel("Choose receipt").setInputFiles({
    buffer: Buffer.from("fictional receipt for manual review"),
    mimeType: "application/pdf",
    name: longReceiptName,
  });
  await expect(page.getByText(/details need to be entered manually/i)).toBeVisible();
  await expect(activeExpenseForm(page)).toHaveCount(1);
  await expectFilenameEllipsis(page, longReceiptName, 390);
  const receiptMoreOptions = activeExpenseForm(page).locator(".record-form__advanced");
  await expect(receiptMoreOptions).not.toHaveAttribute("open", "");
  const receiptReviewTargets = primaryExpenseTargets(page);
  expect(receiptReviewTargets.length).toBe(8);
  await expectTidyExpenseForm(page, receiptReviewTargets);
  const lockedReviewActions = [
    { locator: activeExpenseForm(page).getByRole("button", { name: /^View receipt, Receipt attached,/ }), name: "locked review view receipt" },
  ];
  expect(lockedReviewActions.length).toBe(1);
  await expectExactActionTargets(page, lockedReviewActions);
  await expect(activeExpenseForm(page).getByLabel("Change receipt")).toHaveCount(0);
  await expect(activeExpenseForm(page).getByLabel("Add receipt")).toHaveCount(0);
  await expect(activeExpenseForm(page).getByRole("button", { name: "Receipt options" })).toHaveCount(0);
  await expect(activeExpenseForm(page).getByRole("button", { name: "Change", exact: true })).toHaveCount(0);
  await expect(activeExpenseForm(page).getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand receipt preview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Collapse receipt preview", exact: true })).toHaveCount(0);
  const save = activeExpenseForm(page).getByRole("button", { name: "Save expense" });
  await expectActionsAboveFixedNavigation(page, [{ locator: save, name: "locked review save" }]);
  await activeExpenseForm(page).getByText("More details", { exact: true }).click();
  await expectTidyExpenseForm(page, [...receiptReviewTargets, ...advancedExpenseTargets(page)]);
  await expectActionsAboveFixedNavigation(page, [{ locator: save, name: "locked review save" }]);
  for (const width of [320, 375, 390]) {
    await expectFilenameEllipsis(page, longReceiptName, width);
  }
  expectCleanConsole();
  localApi.assertCalls();
  localApi.assertRejectedRoutes(["POST /api/fictional-expense-route-probe"]);
});

test("mileage form keeps mobile targets clear of navigation", async ({ page }) => {
  const mileageForm = () => page.locator("form.mileage-form:visible");
  const localApi = await installCleanLocalApi(page, {
    calendar: [5, 5], demo: [3, 3], sync: [6, 6],
  });
  const expectCleanConsole = captureConsole(page);
  await chooseProfession(page, "GP");
  await page.goto("/expenses/new/mileage");
  await expect(page.getByRole("heading", { name: "Mileage" })).toBeVisible();
  const targets: TidyTarget[] = [
    { locator: mileageForm().getByLabel("Journey date"), minimum: 48, name: "journey date" },
    { locator: mileageForm().getByLabel("Journey from"), minimum: 48, name: "journey origin" },
    { locator: mileageForm().getByLabel("Journey to"), minimum: 48, name: "journey destination" },
    { locator: mileageForm().getByLabel("Practice (optional)"), minimum: 48, name: "practice" },
    { locator: mileageForm().getByLabel("Business miles"), minimum: 48, name: "business miles" },
    { locator: mileageForm().getByLabel("Confirmed mileage amount"), minimum: 48, name: "confirmed amount" },
    { locator: mileageForm().getByLabel("Notes (optional)"), minimum: 48, name: "notes" },
    { locator: mileageForm().locator(".record-form__check").filter({ hasText: "I have reviewed and confirm this amount" }), name: "mileage confirmation" },
    { locator: mileageForm().locator(".record-form__check").filter({ hasText: "Review with accountant" }), name: "accountant review" },
    { locator: mileageForm().locator(".record-form__advanced > summary"), name: "advanced disclosure" },
    { locator: mileageForm().getByRole("button", { name: "Save mileage expense" }), name: "save mileage" },
  ];
  expect(targets.length).toBe(11);
  const save = mileageForm().getByRole("button", { name: "Save mileage expense" });
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const form = mileageForm();
    await expect(form, `active mileage form is unique at ${width}px`).toHaveCount(1);
    for (const target of targets) {
      await expect(target.locator, `${target.name} is unique at ${width}px`).toHaveCount(1);
      await expect(target.locator, `${target.name} is visible at ${width}px`).toBeVisible();
      const box = await target.locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(target.minimum ?? 44);
      expect(box!.height).toBeGreaterThanOrEqual(target.minimum ?? 44);
    }
    const geometry = await form.evaluate((element) => {
      const controls = [...element.querySelectorAll<HTMLElement>(".record-form__control")]
        .filter((control) => control.getClientRects().length > 0);
      const actionTargets = [...element.querySelectorAll<HTMLElement>(".record-form__check, .record-form__advanced > summary, .record-form__actions .button")]
        .filter((target) => target.getClientRects().length > 0);
      const viewportWidth = document.documentElement.clientWidth;
      return {
        controlsContained: [...controls, ...actionTargets].every((target) => {
          const box = target.getBoundingClientRect();
          return box.left >= 0 && box.right <= viewportWidth;
        }),
        controlsAtLeast48: controls.every((target) => {
          const box = target.getBoundingClientRect();
          return box.width >= 48 && box.height >= 48;
        }),
        documentContained: document.documentElement.scrollWidth === viewportWidth,
        actionsAtLeast44: actionTargets.every((target) => {
          const box = target.getBoundingClientRect();
          return box.width >= 44 && box.height >= 44;
        }),
      };
    });
    expect(geometry).toEqual({ actionsAtLeast44: true, controlsAtLeast48: true, controlsContained: true, documentContained: true });
    const mileageLayout = await form.evaluate((element) => {
      const labelControlPairs = [...element.querySelectorAll<HTMLElement>(".record-form__field")]
        .flatMap((field) => {
          const label = field.querySelector<HTMLElement>("label");
          const control = field.querySelector<HTMLElement>(".record-form__control");
          if (!label || !control || control.getClientRects().length === 0) return [];
          return [{
            labelsClearControls:
              label.getBoundingClientRect().bottom <= control.getBoundingClientRect().top,
          }];
        });
      const disclaimer = [...element.querySelectorAll<HTMLElement>(".record-form__hint")]
        .find((candidate) => candidate.textContent?.startsWith("This is a record-keeping suggestion"));
      if (!disclaimer) return null;
      const disclaimerBox = disclaimer.getBoundingClientRect();
      const formBox = element.getBoundingClientRect();
      const disclaimerStyle = getComputedStyle(disclaimer);
      return {
        disclaimerContained:
          disclaimerBox.left >= formBox.left && disclaimerBox.right <= formBox.right,
        disclaimerWraps:
          disclaimerStyle.whiteSpace === "normal" &&
          disclaimerBox.height > Number.parseFloat(disclaimerStyle.lineHeight),
        labelsClearControls: labelControlPairs.every((pair) => pair.labelsClearControls),
      };
    });
    expect(mileageLayout).toEqual({
      disclaimerContained: true,
      disclaimerWraps: true,
      labelsClearControls: true,
    });
    await save.scrollIntoViewIfNeeded();
    const clearance = await save.evaluate((element) => {
      const action = element.getBoundingClientRect();
      const navigation = document.querySelector<HTMLElement>(".app-navigation")?.getBoundingClientRect();
      return navigation ? action.bottom <= navigation.top + 1 : false;
    });
    expect(clearance).toBe(true);
  }
  await mileageForm().getByLabel("Journey date").fill("2026-08-11");
  await mileageForm().getByLabel("Journey from").fill("Fictional Home");
  await mileageForm().getByLabel("Journey to").fill("Fictional Practice");
  await mileageForm().getByLabel("Business miles").fill("20");
  await expect(mileageForm().getByLabel("Confirmed mileage amount")).toHaveValue("11.00");
  expectCleanConsole();
  localApi.assertCalls();
  localApi.assertRejectedRoutes([]);
});

test("mobile expense review stays contained and keeps its save action above navigation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await chooseProfession(page, "GP");
  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))).toEqual({ clientWidth: width, scrollWidth: width });
    await expect(page.getByLabel("Tax period")).toBeVisible();
    await expect(page.getByTestId("expense-summary")).toBeVisible();
  }

  await page.goto("/expenses/new/scan");
  await page.getByLabel("Choose receipt").setInputFiles({
    buffer: Buffer.from("fictional mobile receipt"),
    mimeType: "application/pdf",
    name: "fictional-mobile-receipt.pdf",
  });
  await expect(page.getByText(/details need to be entered manually/i)).toBeVisible();

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>(
        ".record-form__control, .record-form__actions--sticky .button",
      )];
      return {
        clientWidth: document.documentElement.clientWidth,
        controlsContained: controls.every((control) => {
          const bounds = control.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth;
        }),
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(geometry).toEqual({
      clientWidth: width,
      controlsContained: true,
      scrollWidth: width,
    });
  }

  await page.getByLabel("What did you buy?").fill("Fictional Mobile Supplier");
  await page.getByLabel("How much did it cost?", { exact: true }).fill("12.50");
  const save = page.getByRole("button", { name: "Save expense" });
  await expect(save).toBeInViewport();
  const navigation = page.locator(".app-navigation");
  const [saveBox, navigationBox] = await Promise.all([save.boundingBox(), navigation.boundingBox()]);
  expect(saveBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(navigationBox!.y + 1);

  await save.click();
  await expect(page.getByText("Choose a type of expense.")).toBeVisible();
  await expect(page.getByLabel("What type of expense is it?", { exact: true })).toBeFocused();
});

test("legacy user confirms Pharmacist and keeps a manual expense offline after reload", async ({ context, page }) => {
  await chooseProfession(page, "Pharmacist");
  await expect(page.getByText("Using Pharmacist expense categories.")).toBeVisible();
  await page.getByRole("link", { name: "Add it myself" }).click();
  await expect(page.getByRole("option", { name: "GPhC, PDA, and other professional memberships" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /submit.*hmrc/i })).toHaveCount(0);
  await expect(page.getByText(/guaranteed.*deductible/i)).toHaveCount(0);

  await ensureServiceWorkerControl(page);
  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
  await page.goto("/expenses/new/manual");
  await page.getByLabel("What did you buy?").fill("Fictional Offline Supplier");
  await page.getByLabel("How much did it cost?", { exact: true }).fill("18.75");
  await page.getByLabel("When did you buy it?", { exact: true }).fill("2026-08-12");
  await page.getByLabel("What type of expense is it?", { exact: true }).selectOption("professional_memberships");

  await context.setOffline(true);
  try {
    await page.getByRole("button", { name: "Save expense" }).click();
    await expect(page).toHaveURL(/\/expenses$/);
    await expect(page.getByText("Fictional Offline Supplier", { exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    const savedExpense = page.getByRole("article").filter({ hasText: "Fictional Offline Supplier" });
    await expect(savedExpense).toBeVisible();
    await expect(savedExpense.getByText("£18.75", { exact: true })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("local receipt OCR uses only same-origin assets and persists structured edits without raw text", async ({ context, page }) => {
  test.slow();
  const remoteRequests: string[] = [];
  const ocrPaths = new Set<string>();
  const forbiddenRequestsDuringRecognition: string[] = [];
  const recognitionWebSockets: string[] = [];
  const consoleSentinels: string[] = [];
  const postSaveApiRequests: string[] = [];
  let recognitionActive = false;
  let saveInitiated = false;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/ocr/")) ocrPaths.add(url.pathname);
    if (saveInitiated && url.pathname.startsWith("/api/")) {
      postSaveApiRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  page.on("websocket", (socket) => {
    if (recognitionActive) recognitionWebSockets.push(socket.url());
  });
  page.on("console", (message) => {
    if (message.text().includes("RAW_OCR_SENTINEL_NEVER_PERSIST")) {
      consoleSentinels.push(message.text());
    }
  });
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (recognitionActive) {
      const request = route.request();
      const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
      const isLocalOcrAsset =
        isLocal &&
        request.method() === "GET" &&
        url.pathname.startsWith("/ocr/");
      const isLocalNextAsset =
        isLocal &&
        request.method() === "GET" &&
        url.pathname.startsWith("/_next/static/");
      const isCleanBackgroundSync =
        isLocal &&
        request.method() === "POST" &&
        url.pathname === "/api/sync" &&
        !/RAW_OCR_SENTINEL_NEVER_PERSIST|rawOcr|ocrText|recognizedText/.test(
          request.postData() ?? "",
        );
      if (!isLocalOcrAsset && !isLocalNextAsset && !isCleanBackgroundSync) {
        forbiddenRequestsDuringRecognition.push(
          `${request.method()} ${url.pathname} (${request.resourceType()})`,
        );
      }
    }
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      await route.continue();
      return;
    }
    remoteRequests.push(url.href);
    await route.abort("blockedbyclient");
  });

  await chooseProfession(page, "GP");
  await page.getByRole("link", { name: "Scan a receipt" }).click();
  await expect(page.getByLabel("Choose receipt")).toBeVisible();
  recognitionActive = true;
  await page.getByLabel("Choose receipt").setInputFiles({
    buffer: await fictionalReceiptPng(page),
    mimeType: "image/png",
    name: "fictional-local-receipt.png",
  });
  await expect(page.getByRole("heading", { name: "Review receipt" })).toBeVisible({ timeout: 90_000 });
  recognitionActive = false;
  await expect(page.getByLabel("What did you buy?")).toHaveValue(/Fictional Medical Supplies/i);
  await expect(page.getByLabel("How much did it cost?", { exact: true })).toHaveValue("42.99");
  await expect(page.getByLabel("When did you buy it?", { exact: true })).toHaveValue("2026-08-12");
  await expectReceiptAttached(page, "fictional-local-receipt.png");
  const previewToggle = page.getByRole("button", { name: "Expand receipt preview", exact: true });
  const newTabOpener = activeExpenseForm(page).getByRole("button", {
    name: /^View receipt, Receipt attached,/,
  });
  await expect(previewToggle).toHaveCount(1);
  await expect(newTabOpener).toHaveCount(1);
  await expect(newTabOpener).toHaveText("View receipt");
  await previewToggle.click();
  await expect(page.getByRole("button", { name: "Collapse receipt preview", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Collapse receipt preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand receipt preview", exact: true })).toHaveCount(1);

  await page.getByLabel("What did you buy?").fill("Edited Fictional Medical Supplier");
  await page.getByLabel("What type of expense is it?", { exact: true }).selectOption("practice_medical_supplies");
  saveInitiated = true;
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Edited Fictional Medical Supplier", { exact: true })).toBeVisible();

  const privacyState = await page.evaluate(async () => {
    const forbiddenSentinel = "RAW_OCR_SENTINEL_NEVER_PERSIST";
    const forbiddenField = /rawOcr|ocrText|recognizedText/;
    const open = indexedDB.open("locum-manager");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const names = ["expenses", "outbox", "receiptQueue"].filter((name) => database.objectStoreNames.contains(name));
    const transaction = database.transaction(names, "readonly");
    const result: Record<string, unknown[]> = {};
    await Promise.all(names.map((name) => new Promise<void>((resolve, reject) => {
      const request = transaction.objectStore(name).getAll();
      request.onsuccess = () => { result[name] = request.result; resolve(); };
      request.onerror = () => reject(request.error);
    })));
    database.close();
    const indexedDb = JSON.stringify(result);
    const webStorage = JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    });
    let cacheContainsSentinel = false;
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const type = response?.headers.get("content-type") ?? "";
        if (response && /(?:json|text|javascript|html)/i.test(type)) {
          if ((await response.clone().text()).includes(forbiddenSentinel)) {
            cacheContainsSentinel = true;
          }
        }
      }
    }
    return {
      cacheContainsSentinel,
      indexedDbContainsForbiddenField: forbiddenField.test(indexedDb),
      indexedDbContainsSentinel: indexedDb.includes(forbiddenSentinel),
      webStorageContainsForbiddenField: forbiddenField.test(webStorage),
      webStorageContainsSentinel: webStorage.includes(forbiddenSentinel),
    };
  });
  expect(privacyState).toEqual({
    cacheContainsSentinel: false,
    indexedDbContainsForbiddenField: false,
    indexedDbContainsSentinel: false,
    webStorageContainsForbiddenField: false,
    webStorageContainsSentinel: false,
  });
  expect(forbiddenRequestsDuringRecognition).toEqual([]);
  expect(recognitionWebSockets).toEqual([]);
  expect(consoleSentinels).toEqual([]);
  expect(
    postSaveApiRequests.every((request) =>
      /^(?:GET|POST) \/api\/(?:demo-data|sync|google-calendar\/sync|expenses\/[^/]+\/receipt)$/.test(request),
    ),
  ).toBe(true);
  expect(remoteRequests).toEqual([]);
  expect(ocrPaths).toContain("/ocr/worker.min.js");
  expect(ocrPaths).toContain("/ocr/eng.traineddata.gz");
});

test("PDF and HEIC receipts remain attached for safe manual entry", async ({ page }) => {
  await chooseProfession(page, "GP");
  await page.getByRole("link", { name: "Scan a receipt" }).click();

  for (const receipt of [
    { mimeType: "application/pdf", name: "fictional-manual.pdf" },
    { mimeType: "image/heic", name: "fictional-manual.heic" },
  ]) {
    await page.getByLabel("Choose receipt").setInputFiles({ buffer: Buffer.from("fictional attachment"), ...receipt });
    await expect(page.getByText(/details need to be entered manually/i)).toBeVisible();
    await expectReceiptAttached(page, receipt.name);
    await expect(page.getByLabel("What did you buy?")).toBeFocused();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("dialog", { name: "Discard receipt changes?" })).toBeVisible();
    await page.getByRole("button", { name: "Discard and leave" }).click();
    await expect(page.getByLabel("Choose receipt")).toBeVisible();
  }
});

test("linked mileage shows the threshold split, requires reconfirmation, and reloads", async ({ page }) => {
  await page.goto("/dashboard");
  await waitForDatabase(page);
  await page.evaluate(async ({ ownerId, sessionId }) => {
    const open = indexedDB.open("locum-manager");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const transaction = database.transaction(["practices", "sessions", "expenses"], "readwrite");
    const record = (recordType: string, id: string, data: Record<string, unknown>) => ({
      data, deletedAt: null, id, localRevision: 1, ownerId, recordType,
      serverRevision: 1, syncState: "synced", updatedAt: "2026-08-12T07:00:00.000Z",
    });
    transaction.objectStore("practices").put(record("practices", "practice-a", {
      name: "Fictional Riverside Practice", billingAddress: { formatted: "1 Fiction Road" },
      defaultHourlyRatePence: 7000, paymentTermsDays: 30, archived: false,
    }));
    transaction.objectStore("sessions").put(record("sessions", sessionId, {
      practiceId: "practice-a", startsAt: "2026-08-12T08:00:00.000Z",
      endsAt: "2026-08-12T14:00:00.000Z", hourlyRatePence: 7000,
      status: "planned", notes: null,
    }));
    transaction.objectStore("expenses").put(record("expenses", "prior-mileage", {
      expenseKind: "mileage", journeyOrigin: "Fictional Home", journeyDestination: "Earlier Practice",
      distanceMiles: 9990, mileageRatePence: 55, linkedSessionId: null,
      expenseDate: "2026-07-01", amountPence: 549450, categoryKey: "mileage_business_travel",
      customCategoryId: null, mtdCategory: "travel_costs", allowablePercentage: 100,
      practiceId: null, supplierDescription: "Earlier fictional mileage", notes: null,
      reimbursedByPractice: false, needsAccountantReview: false, receiptObjectKey: null,
      receiptOriginalName: null, receiptMimeType: null, receiptSizeBytes: null,
      receiptSyncStatus: "none", isDemo: false,
    }));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { ownerId: OWNER, sessionId: SESSION_ID });

  await page.goto("/expenses/new/mileage");
  await page.getByLabel("Link to session (optional)").selectOption(SESSION_ID);
  await page.getByLabel("Journey from").fill("Fictional Home");
  await page.getByLabel("Business miles").fill("20");
  await expect(page.getByText(/10 miles at 55p/i)).toBeVisible();
  await expect(page.getByText(/10 miles at 25p/i)).toBeVisible();
  await expect(page.getByLabel("Confirmed mileage amount")).toHaveValue("8.00");
  await page.getByLabel("Confirmed mileage amount").fill("7.75");
  await page.getByLabel("I have reviewed and confirm this amount").check();
  await page.getByLabel("Business miles").fill("21");
  await expect(page.getByLabel("I have reviewed and confirm this amount")).not.toBeChecked();
  await page.getByLabel("I have reviewed and confirm this amount").check();
  await page.getByRole("button", { name: "Save mileage expense" }).click();
  await expect(page.getByText("Business mileage: Fictional Home to Fictional Riverside Practice", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("£7.75", { exact: true })).toBeVisible();

  const saved = await page.evaluate(async ({ sessionId }) => {
    const open = indexedDB.open("locum-manager");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const request = database.transaction("expenses", "readonly").objectStore("expenses").getAll();
    const rows = await new Promise<Array<{ data: Record<string, unknown> }>>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return rows.find((row) => row.data.linkedSessionId === sessionId)?.data ?? null;
  }, { sessionId: SESSION_ID });
  expect(saved).toMatchObject({
    amountPence: 775,
    categoryKey: "mileage_business_travel",
    distanceMiles: 21,
    linkedSessionId: SESSION_ID,
    mtdCategory: "travel_costs",
  });
});
