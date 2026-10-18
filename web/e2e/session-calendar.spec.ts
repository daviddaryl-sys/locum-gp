import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";

const practiceName = "Fictional Medical Centre";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("locum-manager:install-guide-dismissed", "true");
  });
});

async function createPractice(page: Page, name = practiceName) {
  await page.goto("/practices/new");
  await page.getByLabel("Practice name").fill(name);
  await page.getByLabel("Billing address").fill("1 Fictional Road, London");
  await page.getByLabel("Default hourly rate").fill("65.00");
  await page.getByLabel("Payment terms").fill("30");
  await page.getByRole("button", { name: "Save practice" }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();
}

async function createSession(
  page: Page,
  date: string,
  start: string,
  end: string,
  practice = practiceName,
) {
  await page.goto("/sessions/new");
  await page.getByLabel("Practice").selectOption({ label: practice });
  await page.getByLabel("Session date").fill(date);
  await page.getByLabel("Start time").fill(start);
  await page.getByLabel("End time").fill(end);
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("Saved on this device.")).toBeVisible();
}

async function markLatestSessionStatus(
  page: Page,
  status: "cancelled" | "invoiced",
) {
  await page.evaluate(async (nextStatus) => {
    const open = indexedDB.open("locum-manager");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const transaction = database.transaction("sessions", "readwrite");
    const store = transaction.objectStore("sessions");
    const sessions = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const session = sessions.sort((left, right) => {
      const leftStart = String((left.data as Record<string, unknown>)?.startsAt ?? "");
      const rightStart = String((right.data as Record<string, unknown>)?.startsAt ?? "");
      return rightStart.localeCompare(leftStart);
    })[0];
    if (!session) throw new Error("Fictional session was not stored.");
    session.data = { ...(session.data as Record<string, unknown>), status: nextStatus };
    store.put(session);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, status);
}

function calendarDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  })
    .format(new Date(`${dateKey}T12:00:00.000Z`))
    .replace(",", "");
}

async function holdAndDragWithMouse(
  page: Page,
  card: Locator,
  targetDate: Locator,
) {
  const cardBox = await card.boundingBox();
  const targetBox = await targetDate.boundingBox();
  if (!cardBox || !targetBox) throw new Error("Visible calendar drag targets are unavailable.");

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(400);
  await expect(card).toHaveAttribute("data-dragging", "true");
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
  );
  await expect(targetDate).toHaveAttribute("data-drop-target", "true");
  await page.mouse.up();
}

async function dispatchTouch(
  client: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
  x: number,
  y: number,
) {
  await client.send("Input.dispatchTouchEvent", {
    touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y }],
    type,
  });
}

test("renders fictional sessions in the persisted offline calendar", async ({
  context,
  page,
}) => {
  const date = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Europe/London",
      year: "numeric",
    }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  });

  await createPractice(page);
  await createSession(page, date, "09:00", "13:00");
  await createSession(page, date, "14:00", "17:00");
  await markLatestSessionStatus(page, "cancelled");

  await page.goto("/sessions");
  await expect(page.getByRole("button", { name: "List" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Calendar" }).click();
  const calendar = page.getByRole("region", { name: "Session calendar" });
  await expect(calendar).toBeVisible();
  await expect(calendar.getByRole("link", { name: new RegExp(practiceName) })).toHaveCount(2);
  await expect(calendar.getByText("Cancelled", { exact: true })).toBeVisible();

  const selectedDateButton = calendar.locator("tbody button[aria-pressed='true']");
  await selectedDateButton.dblclick();
  const dateDialog = page.getByRole("dialog");
  await expect(dateDialog).toBeVisible();
  await expect(
    dateDialog.getByRole("link", { name: "Add session" }),
  ).toHaveAttribute("href", `/sessions/new?date=${date}`);
  await dateDialog.getByRole("link", { name: "Add session" }).click();
  await expect(page.getByLabel("Session date")).toHaveValue(date);
  await page.goBack();

  await page.getByRole("button", { name: "Add or edit sessions" }).click();
  const editLink = page
    .getByRole("dialog")
    .getByRole("link", { name: new RegExp(practiceName) })
    .first();
  await expect(editLink).toHaveAttribute("href", /\/sessions\/[0-9a-f-]+$/);
  await editLink.click();
  await expect(page.getByRole("heading", { name: "Edit session" })).toBeVisible();
  await page.goBack();

  const currentMonth = calendar.locator(".session-calendar__header h2");
  const firstMonth = await currentMonth.textContent();
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await expect(currentMonth).not.toHaveText(firstMonth ?? "");
  await calendar.getByRole("button", { name: "Next month" }).click();
  await expect(currentMonth).toHaveText(firstMonth ?? "");

  await calendar.getByRole("link", { name: new RegExp(practiceName) }).first().click();
  await expect(page.getByRole("heading", { name: "Edit session" })).toBeVisible();
  await page.goBack();

  await page.reload();
  await expect(page.getByRole("button", { name: "Calendar" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .locator(".app-navigation__items a"),
  ).toHaveCount(5);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Session calendar" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(practiceName) })).toHaveCount(2);
  } finally {
    await context.setOffline(false);
  }
});

test("moves a fictional session by held pointer only after confirmation and persists it", async ({
  page,
}) => {
  await page.setViewportSize({ height: 1200, width: 1280 });
  const sourceDate = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Europe/London",
      year: "numeric",
    }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  });

  await createPractice(page);
  await createSession(page, sourceDate, "09:00", "13:00");
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Calendar" }).click();

  const calendar = page.getByRole("region", { name: "Session calendar" });
  const card = calendar.locator(".session-calendar__agenda-card").first();
  const source = calendar.locator(`[data-calendar-date="${sourceDate}"]`);
  const target = calendar
    .locator(`[data-calendar-date]:not([data-calendar-date="${sourceDate}"])`)
    .last();
  const targetDate = await target.getAttribute("data-calendar-date");
  if (!targetDate) throw new Error("Visible calendar target has no date.");
  const sourceLabel = calendarDateLabel(sourceDate);
  const targetLabel = calendarDateLabel(targetDate);

  await expect(card.getByRole("link", { name: new RegExp(practiceName) })).toBeVisible();
  await expect(source).toHaveAccessibleName(`${sourceLabel}, 1 session`);
  await expect(target).toHaveAccessibleName(`${targetLabel}, 0 sessions`);

  await holdAndDragWithMouse(page, card, target);
  let dialog = page.getByRole("dialog", { name: "Move session" });
  await expect(dialog).toContainText(sourceLabel);
  await expect(dialog).toContainText(targetLabel);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(source).toHaveAccessibleName(`${sourceLabel}, 1 session`);
  await expect(target).toHaveAccessibleName(`${targetLabel}, 0 sessions`);
  await expect(card.getByRole("link", { name: new RegExp(practiceName) })).toBeVisible();

  await holdAndDragWithMouse(page, card, target);
  dialog = page.getByRole("dialog", { name: "Move session" });
  await expect(dialog).toContainText(sourceLabel);
  await expect(dialog).toContainText(targetLabel);
  await dialog.getByRole("button", { name: "Move session" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(source).toHaveAccessibleName(`${sourceLabel}, 0 sessions`);
  await expect(target).toHaveAccessibleName(`${targetLabel}, 1 session`);
  await target.click();
  await expect(
    calendar.locator(".session-calendar__agenda-card").getByRole("link", {
      name: new RegExp(practiceName),
    }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Calendar" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const reloadedCalendar = page.getByRole("region", { name: "Session calendar" });
  const persistedTarget = reloadedCalendar.locator(`[data-calendar-date="${targetDate}"]`);
  await expect(persistedTarget).toHaveAccessibleName(`${targetLabel}, 1 session`);
  await persistedTarget.click();
  await expect(
    reloadedCalendar.locator(".session-calendar__agenda-card").getByRole("link", {
      name: new RegExp(practiceName),
    }),
  ).toBeVisible();
});

test("keeps an early card swipe scrollable and a held touch draggable", async ({ page }) => {
  await page.setViewportSize({ height: 640, width: 390 });
  const dates = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Europe/London",
      year: "numeric",
    }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    const sourceDate = `${value("year")}-${value("month")}-${value("day")}`;
    return { sourceDate };
  });

  await createPractice(page);
  await createSession(page, dates.sourceDate, "09:00", "13:00");
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Calendar" }).click();

  const calendar = page.getByRole("region", { name: "Session calendar" });
  const card = calendar.locator(".session-calendar__agenda-card").first();
  const editLink = card.getByRole("link", { name: new RegExp(practiceName) });
  const targetDate = calendar.locator("[data-calendar-date]").nth(35);
  const targetDateKey = await targetDate.getAttribute("data-calendar-date");
  if (!targetDateKey) throw new Error("Visible calendar target has no date.");
  await expect(card).toBeVisible();
  await expect(editLink).toHaveAttribute("href", /\/sessions\/[0-9a-f-]+$/);

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });

  await card.scrollIntoViewIfNeeded();
  const earlyBox = await card.boundingBox();
  if (!earlyBox) throw new Error("Fictional session card has no touch target.");
  const earlyStart = await page.evaluate(() => window.scrollY);
  const earlyDirection = earlyStart > 0 ? 90 : -90;
  const earlyX = earlyBox.x + earlyBox.width / 2;
  const earlyY = earlyBox.y + earlyBox.height / 2;
  await dispatchTouch(client, "touchStart", earlyX, earlyY);
  await dispatchTouch(client, "touchMove", earlyX, earlyY + earlyDirection);
  await page.waitForTimeout(100);
  await dispatchTouch(client, "touchEnd", earlyX, earlyY + earlyDirection);
  await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(earlyStart);
  await expect(page.getByRole("dialog", { name: "Move session" })).toHaveCount(0);
  await page.waitForTimeout(500);

  await card.scrollIntoViewIfNeeded();
  const edgeBox = await card.boundingBox();
  const offscreenTargetBox = await targetDate.boundingBox();
  if (!edgeBox || !offscreenTargetBox) {
    throw new Error("Calendar edge-scroll targets are unavailable.");
  }
  const edgeStart = await page.evaluate(() => window.scrollY);
  const edgeX = offscreenTargetBox.x + offscreenTargetBox.width / 2;
  const edgeY = edgeBox.y + edgeBox.height / 2;
  await dispatchTouch(client, "touchStart", edgeX, edgeY);
  await page.waitForTimeout(420);
  await expect(card).toHaveAttribute("data-dragging", "true");
  await dispatchTouch(client, "touchMove", edgeX, 88);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(edgeStart);
  let edgeTargetDate: string | null = null;
  const neutralEdgeY = 180;
  for (let attempt = 0; attempt < 20 && !edgeTargetDate; attempt += 1) {
    await dispatchTouch(client, "touchMove", edgeX, neutralEdgeY);
    const hitDate = await page.evaluate(({ x, y }) => (
      document.elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-calendar-date]")
        ?.dataset.calendarDate ?? null
    ), { x: edgeX, y: neutralEdgeY });
    if (hitDate && hitDate !== dates.sourceDate) {
      edgeTargetDate = hitDate;
      break;
    }
    await dispatchTouch(client, "touchMove", edgeX, 88);
    await page.waitForTimeout(100);
  }
  if (!edgeTargetDate) throw new Error("Edge scrolling did not expose a drop date.");
  const edgeTarget = calendar.locator(`[data-calendar-date="${edgeTargetDate}"]`);
  await expect(edgeTarget).toHaveAttribute("data-drop-target", "true");
  await dispatchTouch(client, "touchEnd", edgeX, neutralEdgeY);
  const edgeDialog = page.getByRole("dialog", { name: "Move session" });
  await expect(edgeDialog).toBeVisible();
  await expect(edgeDialog.getByRole("combobox", { name: "Move to date" })).toHaveValue(
    edgeTargetDate,
  );
  await edgeDialog.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(500);

  await page.evaluate(({ sourceSelector, targetSelector }) => {
    const source = document.querySelector(sourceSelector);
    const target = document.querySelector(targetSelector);
    if (!source || !target) throw new Error("Calendar touch targets are unavailable.");
    const sourceY = source.getBoundingClientRect().top + window.scrollY;
    const targetY = target.getBoundingClientRect().top + window.scrollY;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, Math.max(0, (sourceY + targetY) / 2 - window.innerHeight / 2));
  }, {
    sourceSelector: ".session-calendar__agenda-card",
    targetSelector: `[data-calendar-date="${targetDateKey}"]`,
  });

  const heldBox = await card.boundingBox();
  const targetBox = await targetDate.boundingBox();
  if (!heldBox || !targetBox) throw new Error("Visible calendar drag targets are unavailable.");
  const heldX = heldBox.x + heldBox.width / 2;
  const heldY = heldBox.y + heldBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height / 2;
  const heldScroll = await page.evaluate(() => window.scrollY);
  const hitDate = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-calendar-date]");
    return hit?.dataset.calendarDate ?? null;
  }, { x: targetX, y: targetY });
  expect(hitDate).toBe(targetDateKey);
  const hitCard = await page.evaluate(({ x, y }) => Boolean(
    document.elementFromPoint(x, y)?.closest(".session-calendar__agenda-card"),
  ), { x: heldX, y: heldY });
  expect(hitCard).toBe(true);

  await dispatchTouch(client, "touchStart", heldX, heldY);
  await page.waitForTimeout(420);
  await expect(card).toHaveAttribute("data-dragging", "true");
  await dispatchTouch(client, "touchMove", targetX, targetY);
  await page.waitForTimeout(50);
  await expect(targetDate).toHaveAttribute("data-drop-target", "true");
  expect(await page.evaluate(() => window.scrollY)).toBe(heldScroll);
  await dispatchTouch(client, "touchEnd", targetX, targetY);

  const dialog = page.getByRole("dialog", { name: "Move session" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Move to date" })).toHaveValue(
    targetDateKey,
  );
  await client.detach();
});

test("direct calendar marker touch drag moves only the chosen fictional session", async ({
  page,
}) => {
  await page.setViewportSize({ height: 360, width: 390 });
  const secondPractice = "Sample Surgery";
  const sourceDate = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      month: "2-digit",
      timeZone: "Europe/London",
      year: "numeric",
    }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    const firstOfMonth = new Date(`${value("year")}-${value("month")}-01T12:00:00.000Z`);
    const mondayOffset = (firstOfMonth.getUTCDay() + 6) % 7;
    firstOfMonth.setUTCDate(firstOfMonth.getUTCDate() - mondayOffset);
    return firstOfMonth.toISOString().slice(0, 10);
  });

  await createPractice(page);
  await createPractice(page, secondPractice);
  await createSession(page, sourceDate, "09:00", "13:00");
  await createSession(page, sourceDate, "14:00", "17:00", secondPractice);
  await markLatestSessionStatus(page, "invoiced");
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Calendar" }).click();

  const calendar = page.getByRole("region", { name: "Session calendar" });
  const sourceDateButton = calendar.locator(`[data-calendar-date="${sourceDate}"]`);
  const sourceCell = sourceDateButton.locator("xpath=..");
  const markers = sourceCell.locator(".session-calendar__marker");
  const chosenMarker = sourceCell.getByRole("button", {
    name: `${practiceName}, 09:00 to 13:00, Planned session`,
  });
  const invoicedMarker = sourceCell.getByRole("button", {
    name: `${secondPractice}, 14:00 to 17:00, Invoiced session, move unavailable: invoiced`,
  });

  await expect(markers).toHaveCount(2);
  await expect(chosenMarker).toBeVisible();
  await expect(invoicedMarker).toHaveAttribute("aria-disabled", "true");
  const chosenId = await chosenMarker.getAttribute("data-session-id");
  const invoicedId = await invoicedMarker.getAttribute("data-session-id");
  if (!chosenId || !invoicedId) throw new Error("Fictional markers have no session identity.");
  const [chosenColour, invoicedColour] = await Promise.all([
    chosenMarker.evaluate((element) => getComputedStyle(element).backgroundColor),
    invoicedMarker.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(chosenColour).not.toBe(invoicedColour);

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });

  await chosenMarker.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const earlyBox = await chosenMarker.boundingBox();
  if (!earlyBox) throw new Error("Fictional marker has no touch target.");
  const earlyStart = await page.evaluate(() => window.scrollY);
  const earlyX = earlyBox.x + earlyBox.width / 2;
  const earlyY = earlyBox.y + earlyBox.height / 2;
  await dispatchTouch(client, "touchStart", earlyX, earlyY);
  await dispatchTouch(client, "touchMove", earlyX, earlyY - 70);
  await page.waitForTimeout(100);
  await dispatchTouch(client, "touchEnd", earlyX, earlyY - 70);
  await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(earlyStart);
  await expect(page.getByRole("dialog", { name: "Move session" })).toHaveCount(0);
  await page.waitForTimeout(520);

  await chosenMarker.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.evaluate(() => window.scrollBy({ behavior: "auto", top: -48 }));
  const heldBox = await chosenMarker.boundingBox();
  if (!heldBox) throw new Error("Calendar marker edge-scroll source is unavailable.");
  const initiallyOffscreenDates = await calendar.locator("[data-calendar-date]").evaluateAll(
    (buttons) => buttons.flatMap((button) => {
      const element = button as HTMLElement;
      const bounds = element.getBoundingClientRect();
      const dateKey = element.dataset.calendarDate;
      return dateKey && (bounds.top >= window.innerHeight || bounds.bottom <= 0)
        ? [dateKey]
        : [];
    }),
  );
  expect(initiallyOffscreenDates.length).toBeGreaterThan(0);

  const heldX = heldBox.x + heldBox.width / 2;
  const heldY = heldBox.y + heldBox.height / 2;
  const calendarBoxBeforeActivation = await calendar.boundingBox();
  if (!calendarBoxBeforeActivation) {
    throw new Error("Calendar geometry is unavailable before drag activation.");
  }
  const hitMarkerId = await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)
      ?.closest<HTMLElement>(".session-calendar__marker")
      ?.dataset.sessionId ?? null
  ), { x: heldX, y: heldY });
  expect(hitMarkerId).toBe(chosenId);
  const edgeStart = await page.evaluate(() => window.scrollY);
  await dispatchTouch(client, "touchStart", heldX, heldY);
  await page.waitForTimeout(420);
  await expect(page.getByText("Move session — drag to another date.")).toBeVisible();
  await expect(chosenMarker).toHaveAttribute("data-dragging", "true");
  const [heldBoxAfterActivation, calendarBoxAfterActivation] = await Promise.all([
    chosenMarker.boundingBox(),
    calendar.boundingBox(),
  ]);
  if (!heldBoxAfterActivation || !calendarBoxAfterActivation) {
    throw new Error("Calendar geometry is unavailable after drag activation.");
  }
  const heldCentreAfterActivation = {
    x: heldBoxAfterActivation.x + heldBoxAfterActivation.width / 2,
    y: heldBoxAfterActivation.y + heldBoxAfterActivation.height / 2,
  };
  expect(Math.abs(heldCentreAfterActivation.x - heldX)).toBeLessThanOrEqual(1);
  expect(Math.abs(heldCentreAfterActivation.y - heldY)).toBeLessThanOrEqual(1);
  expect(Math.abs(calendarBoxAfterActivation.x - calendarBoxBeforeActivation.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(calendarBoxAfterActivation.y - calendarBoxBeforeActivation.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(calendarBoxAfterActivation.width - calendarBoxBeforeActivation.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(calendarBoxAfterActivation.height - calendarBoxBeforeActivation.height)).toBeLessThanOrEqual(1);
  await dispatchTouch(client, "touchMove", heldX, 340);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(edgeStart);
  let targetDate: string | null = null;
  const neutralY = 180;
  for (let attempt = 0; attempt < 20 && !targetDate; attempt += 1) {
    await dispatchTouch(client, "touchMove", heldX, neutralY);
    const hitDate = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      const dateButton = element?.closest<HTMLElement>("[data-calendar-date]")
        ?? element?.closest("td")?.querySelector<HTMLElement>("[data-calendar-date]");
      return dateButton?.dataset.calendarDate ?? null;
    }, { x: heldX, y: neutralY });
    const highlightedDate = await calendar
      .locator('[data-calendar-date][data-drop-target="true"]')
      .evaluateAll((buttons) => buttons[0]?.getAttribute("data-calendar-date") ?? null);
    const resolvedDate = highlightedDate ?? hitDate;
    if (resolvedDate && initiallyOffscreenDates.includes(resolvedDate)) {
      targetDate = resolvedDate;
      break;
    }
    await dispatchTouch(client, "touchMove", heldX, 340);
    await page.waitForTimeout(100);
  }
  if (!targetDate) throw new Error("Continuous edge scrolling did not expose a new date.");
  const targetDateButton = calendar.locator(`[data-calendar-date="${targetDate}"]`);
  await expect(targetDateButton).toHaveAttribute("data-drop-target", "true");
  const targetBoxShadow = await targetDateButton.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  expect(targetBoxShadow).not.toBe("none");
  await dispatchTouch(client, "touchEnd", heldX, neutralY);

  const dialog = page.getByRole("dialog", { name: "Move session" });
  await expect(dialog).toContainText(practiceName);
  await expect(dialog).not.toContainText(secondPractice);
  await expect(dialog.getByRole("combobox", { name: "Move to date" })).toHaveValue(
    targetDate,
  );
  await dialog.getByRole("button", { name: "Move session" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Session moved successfully.");

  await page.reload();
  const reloadedCalendar = page.getByRole("region", { name: "Session calendar" });
  const reloadedSourceCell = reloadedCalendar
    .locator(`[data-calendar-date="${sourceDate}"]`)
    .locator("xpath=..");
  const reloadedTargetCell = reloadedCalendar
    .locator(`[data-calendar-date="${targetDate}"]`)
    .locator("xpath=..");
  await expect(reloadedSourceCell.locator(`[data-session-id="${chosenId}"]`)).toHaveCount(0);
  await expect(reloadedSourceCell.locator(`[data-session-id="${invoicedId}"]`)).toHaveCount(1);
  await expect(reloadedTargetCell.locator(`[data-session-id="${chosenId}"]`)).toHaveCount(1);
  await expect(reloadedTargetCell.locator(`[data-session-id="${invoicedId}"]`)).toHaveCount(0);

  const lockedMarker = reloadedSourceCell.locator(`[data-session-id="${invoicedId}"]`);
  await lockedMarker.scrollIntoViewIfNeeded();
  const lockedBox = await lockedMarker.boundingBox();
  const lockedTargetBox = await reloadedTargetCell
    .locator("[data-calendar-date]")
    .boundingBox();
  if (!lockedBox || !lockedTargetBox) throw new Error("Locked marker targets are unavailable.");
  const lockedX = lockedBox.x + lockedBox.width / 2;
  const lockedY = lockedBox.y + lockedBox.height / 2;
  const lockedTargetX = lockedTargetBox.x + lockedTargetBox.width / 2;
  const lockedTargetY = lockedTargetBox.y + lockedTargetBox.height / 2;

  await page.mouse.move(lockedX, lockedY);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await expect(lockedMarker).not.toHaveAttribute("data-pressed", "true");
  await expect(lockedMarker).not.toHaveAttribute("data-dragging", "true");
  await page.mouse.move(lockedTargetX, lockedTargetY);
  await page.mouse.up();
  await dispatchTouch(client, "touchStart", lockedX, lockedY);
  await page.waitForTimeout(400);
  await expect(lockedMarker).not.toHaveAttribute("data-pressed", "true");
  await expect(lockedMarker).not.toHaveAttribute("data-dragging", "true");
  await dispatchTouch(client, "touchMove", lockedTargetX, lockedTargetY);
  await dispatchTouch(client, "touchEnd", lockedTargetX, lockedTargetY);
  await expect(page.getByRole("dialog", { name: "Move session" })).toHaveCount(0);
  await client.detach();
});

test("keeps an invoiced fictional session locked for pointer and touch moves", async ({
  page,
}) => {
  await page.setViewportSize({ height: 1200, width: 1280 });
  const sourceDate = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Europe/London",
      year: "numeric",
    }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  });

  await createPractice(page);
  await createSession(page, sourceDate, "09:00", "13:00");
  await markLatestSessionStatus(page, "invoiced");
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Calendar" }).click();

  const calendar = page.getByRole("region", { name: "Session calendar" });
  const card = calendar.locator(".session-calendar__agenda-card").first();
  const unavailable = card.getByRole("button", { name: "Move unavailable: invoiced" });
  const target = calendar
    .locator(`[data-calendar-date]:not([data-calendar-date="${sourceDate}"])`)
    .last();
  await expect(unavailable).toBeVisible();
  await expect(unavailable).toBeDisabled();

  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) throw new Error("Visible invoiced drag targets are unavailable.");
  const cardX = cardBox.x + cardBox.width / 2;
  const cardY = cardBox.y + cardBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(cardX, cardY);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await expect(card).not.toHaveAttribute("data-pressed", "true");
  await expect(card).not.toHaveAttribute("data-dragging", "true");
  await page.mouse.move(targetX, targetY);
  await page.mouse.up();
  await expect(target).not.toHaveAttribute("data-drop-target", "true");
  await expect(page.getByRole("dialog", { name: "Move session" })).toHaveCount(0);

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await dispatchTouch(client, "touchStart", cardX, cardY);
  await page.waitForTimeout(400);
  await expect(card).not.toHaveAttribute("data-pressed", "true");
  await expect(card).not.toHaveAttribute("data-dragging", "true");
  await dispatchTouch(client, "touchMove", targetX, targetY);
  await dispatchTouch(client, "touchEnd", targetX, targetY);
  await expect(target).not.toHaveAttribute("data-drop-target", "true");
  await expect(page.getByRole("dialog", { name: "Move session" })).toHaveCount(0);
  await client.detach();
});
