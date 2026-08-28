import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import CalendarGrid, { EventTooltip } from "@/components/CalendarGrid";
import {
  initialRosterState,
  parseEvents,
  RosterContext,
  rosterReducer,
  capturePreviousEventValues,
  getEventPreviousValue,
  hasEventFieldHistory,
  type RosterContextValue,
  type OperatorRequestEvent,
  type RosterEvent,
} from "@/store/rosterStore";
import { generateHtmlCalendar } from "@/utils/htmlExport";
import { exportWordCalendar } from "@/utils/wordExport";

const originalEvent: OperatorRequestEvent = {
  id: "event-1",
  eventType: "Operator Request",
  date: "2026-08-12",
  startTime: "09:00",
  endTime: "10:00",
  inspectors: ["Robin Macadam"],
  operator: "CPA",
  simulatorCodes: ["CPA01"],
  simulatorCode: "CPA01",
  aircraftType: "A320-200",
  activity: "AE Initial",
  candidateName: "Candidate",
};

function commitTimeEdit(startTime: string, endTime: string): RosterEvent {
  const stateWithOriginal = {
    ...initialRosterState,
    calendarEvents: [originalEvent],
  };
  const stagedEdit: OperatorRequestEvent = {
    ...originalEvent,
    id: "staged-1",
    sourceEventId: originalEvent.id,
    startTime,
    endTime,
  };
  const staged = rosterReducer(stateWithOriginal, {
    type: "ADD_EVENT",
    payload: stagedEdit,
  });
  return rosterReducer(staged, {
    type: "COMMIT_EVENT",
    payload: stagedEdit.id,
  }).calendarEvents[0];
}

function commitEdit(original: RosterEvent, changes: Partial<RosterEvent>): RosterEvent {
  const stagedEdit = {
    ...original,
    ...changes,
    id: "staged-1",
    sourceEventId: original.id,
  } as RosterEvent;
  const staged = rosterReducer(
    { ...initialRosterState, calendarEvents: [original] },
    { type: "ADD_EVENT", payload: stagedEdit },
  );
  return rosterReducer(staged, {
    type: "COMMIT_EVENT",
    payload: stagedEdit.id,
  }).calendarEvents[0];
}

function hydrate(event: RosterEvent): RosterEvent {
  const hydrated = parseEvents(JSON.stringify([event]));
  expect(hydrated).toHaveLength(1);
  return hydrated[0];
}

function renderCalendarTooltip(event: RosterEvent): string {
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800 });
  try {
    return renderToStaticMarkup(
      <EventTooltip
        event={event}
        x={100}
        y={100}
        inspectors={initialRosterState.inspectors}
        qualifications={initialRosterState.qualifications}
      />,
    );
  } finally {
    vi.unstubAllGlobals();
  }
}

function renderCalendar(events: RosterEvent[]): string {
  const contextValue = {
    state: {
      ...initialRosterState,
      calendarEvents: events,
      inspectors: [],
      operators: ["CPA"],
      operatorColors: { CPA: "#006b3c" },
      otherDutiesColors: {},
    },
    setEditingEventId: vi.fn(),
    clearEventHistory: vi.fn(),
  } as unknown as RosterContextValue;
  return renderToStaticMarkup(
    <RosterContext.Provider value={contextValue}>
      <CalendarGrid
        year={2026}
        month={8}
        filterOperators={new Set()}
        filterInspectors={new Set()}
        onFilterOperatorsChange={vi.fn()}
        onFilterInspectorsChange={vi.fn()}
      />
    </RosterContext.Provider>,
  );
}

async function wordDocumentXml(event: RosterEvent): Promise<string> {
  const blob = await exportWordCalendar(
    2026,
    8,
    [event],
    { CPA: "#006b3c" },
  );
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return strFromU8(archive["word/document.xml"]);
}

describe("edited time ranges", () => {
  it.each([
    ["start-only", "09:30", "10:00"],
    ["end-only", "09:00", "10:30"],
    ["combined", "09:30", "10:30"],
  ])("keeps the prior range after %s edits and hydration", (_label, start, end) => {
    const edited = commitTimeEdit(start, end);
    expect(edited).toMatchObject({
      startTime: start,
      endTime: end,
      previousStartTime: "09:00",
      previousEndTime: "10:00",
    });

    expect(hydrate(edited)).toMatchObject({
      startTime: start,
      endTime: end,
      previousStartTime: "09:00",
      previousEndTime: "10:00",
    });
  });

  it.each([
    ["start-only", "09:30", "10:00"],
    ["end-only", "09:00", "10:30"],
    ["combined", "09:30", "10:30"],
  ])("shows current and prior ranges in calendar, HTML, and Word exports for %s edits", async (_label, start, end) => {
    const event = hydrate(commitTimeEdit(start, end));
    const tooltip = renderCalendarTooltip(event);
    expect(tooltip).toContain(`${start}–${end}`);
    expect(tooltip).toContain("09:00–10:00");
    expect(tooltip).toContain("line-through");

    const html = generateHtmlCalendar(
      2026,
      8,
      [event],
      { CPA: "#006b3c" },
      {},
      ["CPA"],
      ["Robin Macadam"],
      new Map(),
    );
    expect(html).toContain(
      `\\u003cspan class=\\"td-time-current\\"\\u003e${start} \\u0026ndash; ${end}\\u003c/span\\u003e`,
    );
    expect(html).toContain(
      '\\u003cs class=\\"td-time-old\\"\\u003e09:00 \\u0026ndash; 10:00\\u003c/s\\u003e',
    );

    const documentXml = await wordDocumentXml(event);
    expect(documentXml).toContain(`${start.replace(":", "")} - ${end.replace(":", "")}`);
    expect(documentXml).toContain("0900 - 1000");
    expect(documentXml).toMatch(/<w:strike(?:\/>|>)/);
  });

  it("does not add prior-time markup to unchanged events", async () => {
    const tooltip = renderCalendarTooltip(originalEvent);
    expect(tooltip).toContain("09:00–10:00");
    expect(tooltip).not.toContain("line-through");

    const html = generateHtmlCalendar(
      2026,
      8,
      [originalEvent],
      { CPA: "#006b3c" },
      {},
      ["CPA"],
      ["Robin Macadam"],
      new Map(),
    );
    expect(html.match(/<s class=\\"td-time-old\\">/g) ?? []).toHaveLength(0);

    const documentXml = await wordDocumentXml(originalEvent);
    expect(documentXml).not.toContain("<w:strike");
  });
});

describe("all-field edit history", () => {
  it("captures scalar, array, date, time, and inspector changes", () => {
    const edited = commitEdit(originalEvent, {
      date: "2026-08-13",
      startTime: "09:30",
      endTime: "10:30",
      inspectors: ["Steve Chan"],
      operator: "HKA",
      simulatorCodes: ["CPA02"],
      simulatorCode: "CPA02",
      aircraftType: "B777-300ER",
      activity: "AE Renewal",
      candidateName: "New Candidate",
    });

    expect(edited.previousValues).toMatchObject({
      date: "2026-08-12",
      startTime: "09:00",
      endTime: "10:00",
      inspectors: ["Robin Macadam"],
      operator: "CPA",
      simulatorCodes: ["CPA01"],
      aircraftType: "A320-200",
      activity: "AE Initial",
      candidateName: "Candidate",
    });
    expect(hasEventFieldHistory(edited, "operator")).toBe(true);
    expect(getEventPreviousValue(edited, "candidateName").value).toBe("Candidate");
  });

  it("records cleared optional values as null and keeps array order meaningful", () => {
    const surveillance: RosterEvent = {
      ...originalEvent,
      eventType: "Surveillance",
      surveillanceTypes: ["Cabin", "Flight"],
      details: "Route 1",
    } as RosterEvent;
    const edited = commitEdit(surveillance, {
      surveillanceTypes: ["Flight", "Cabin"],
      details: "",
    });
    expect(edited.previousValues).toMatchObject({
      surveillanceTypes: ["Cabin", "Flight"],
      details: "Route 1",
    });

    const duty: RosterEvent = {
      ...originalEvent,
      eventType: "Other Duties",
      operators: ["CPA"],
      subType: "Custom",
      otherDutiesShift: "AM",
      customColor: "#112233",
      remarks: "Original remark",
    } as RosterEvent;
    const cleared = commitEdit(duty, {
      otherDutiesShift: undefined,
      customColor: undefined,
      remarks: "",
    });
    expect(cleared.previousValues).toMatchObject({
      otherDutiesShift: "AM",
      customColor: "#112233",
      remarks: "Original remark",
    });
    expect(cleared.otherDutiesShift).toBeUndefined();
  });

  it("captures Leave fields and fields removed by an event-type change", () => {
    const leave: RosterEvent = {
      ...originalEvent,
      eventType: "Leave",
      leaveType: "Annual",
      leaveShift: "AM",
    } as RosterEvent;
    const editedLeave = commitEdit(leave, {
      leaveType: "Medical",
      leaveShift: "PM",
    });
    expect(editedLeave.previousValues).toMatchObject({
      leaveType: "Annual",
      leaveShift: "AM",
    });

    const switched = commitEdit(originalEvent, {
      eventType: "Leave",
      leaveType: "Annual",
      leaveShift: "PM",
    });
    expect(switched.previousValues).toMatchObject({
      eventType: "Operator Request",
      operator: "CPA",
      simulatorCodes: ["CPA01"],
      activity: "AE Initial",
      leaveType: null,
      leaveShift: null,
    });
  });

  it("clears one field history without removing other field history", () => {
    const edited = commitEdit(originalEvent, {
      operator: "HKA",
      candidateName: "New Candidate",
    });
    const cleared = rosterReducer(
      { ...initialRosterState, calendarEvents: [edited] },
      {
        type: "CLEAR_EVENT_HISTORY",
        payload: { id: edited.id, kind: "operator" },
      },
    ).calendarEvents[0];
    expect(hasEventFieldHistory(cleared, "operator")).toBe(false);
    expect(hasEventFieldHistory(cleared, "candidateName")).toBe(true);
  });

  it("clears start and end time history independently", () => {
    const edited = commitEdit(originalEvent, {
      startTime: "09:30",
      endTime: "10:30",
    });
    const cleared = rosterReducer(
      { ...initialRosterState, calendarEvents: [edited] },
      {
        type: "CLEAR_EVENT_HISTORY",
        payload: { id: edited.id, kind: "startTime" },
      },
    ).calendarEvents[0];
    expect(cleared.previousStartTime).toBeUndefined();
    expect(cleared.previousEndTime).toBe("10:00");
    expect(hasEventFieldHistory(cleared, "endTime")).toBe(true);
  });

  it("preserves the typed history map through hydration", () => {
    const edited = commitEdit(originalEvent, {
      candidateName: "New Candidate",
      activity: "AE Renewal",
    });
    expect(hydrate(edited).previousValues).toMatchObject({
      candidateName: "Candidate",
      activity: "AE Initial",
    });
  });
});

describe("Other Duties calendar pill remarks", () => {
  const duty: RosterEvent = {
    id: "duty-1",
    eventType: "Other Duties",
    date: "2026-08-12",
    startTime: "09:00",
    endTime: "10:00",
    inspectors: [],
    operators: ["CPA"],
    subType: "AEX Course",
    remarks: "  Bring documents <today>  ",
    appendRemarkToCalendarPill: true,
  };

  it("preserves the flag, rejects malformed values, and leaves history fields unchanged", () => {
    expect(hydrate(duty)).toMatchObject({
      appendRemarkToCalendarPill: true,
      remarks: "  Bring documents <today>  ",
    });
    expect(
      parseEvents(
        JSON.stringify([
          { ...duty, id: "legacy", appendRemarkToCalendarPill: "true" },
        ]),
      )[0],
    ).not.toHaveProperty("appendRemarkToCalendarPill");
    expect(capturePreviousEventValues(duty, {
      ...duty,
      appendRemarkToCalendarPill: false,
    })).not.toHaveProperty("appendRemarkToCalendarPill");
  });

  it("adds the trimmed remark only to calendar pills and escapes it in HTML", () => {
    const html = generateHtmlCalendar(
      2026,
      8,
      [duty],
      { CPA: "#006b3c" },
      {},
      ["CPA"],
      [],
      new Map(),
    );
    expect(html).toContain("Bring documents \\u003ctoday\\u003e");
    expect(html).toContain("appendRemarkToCalendarPill");
    expect(html).toContain("function evPillContent");
    expect(html).toContain(
      "appendRemarkToCalendarPill===true&&typeof ev.remarks==='string'",
    );
    expect(renderCalendar([duty])).toContain(
      "CPA AEX Course Bring documents &lt;today&gt; 09:00 – 10:00",
    );
    expect(renderCalendarTooltip(duty)).toContain("Bring documents &lt;today&gt;");
  });

  it("does not append blank or unchecked remarks", () => {
    const withoutFlag = { ...duty, appendRemarkToCalendarPill: false };
    const withBlankRemark = {
      ...duty,
      remarks: "  ",
    };
    expect(renderCalendar([withoutFlag])).toContain(
      "CPA AEX Course 09:00 – 10:00",
    );
    expect(renderCalendar([withoutFlag])).not.toContain("Bring documents");
    expect(renderCalendar([withBlankRemark])).toContain(
      "CPA AEX Course 09:00 – 10:00",
    );
  });
});

describe("HTML v1 changelog", () => {
  const changedChangelog = [
    {
      kind: "changed" as const,
      label: "12 Aug — CPA CPA01",
      detail: ["Time: 09:00–10:00 → 09:30–10:30"],
      date: "2026-08-12",
    },
  ];

  it("does not show a changelog popup for a fresh v1 export", () => {
    const html = generateHtmlCalendar(
      2026,
      8,
      [originalEvent],
      { CPA: "#006b3c" },
      {},
      ["CPA"],
      ["Robin Macadam"],
      new Map(),
      1,
      changedChangelog,
    );

    expect(html).not.toContain('<div class="ov"');
    expect(html).not.toContain("Initial Export");
    expect(html).not.toContain("Time: 09:00");
  });

  it("does not show a changelog popup for an imported v1 export", () => {
    const html = generateHtmlCalendar(
      2026,
      8,
      [originalEvent],
      { CPA: "#006b3c" },
      {},
      ["CPA"],
      ["Robin Macadam"],
      new Map(),
      1,
      changedChangelog,
      undefined,
      [],
      [originalEvent],
      true,
    );

    expect(html).not.toContain('<div class="ov"');
    expect(html).not.toContain("What&#8217;s New in v1");
    expect(html).not.toContain("Time: 09:00");
  });

  it("keeps the changelog popup for v2 exports", () => {
    const html = generateHtmlCalendar(
      2026,
      8,
      [originalEvent],
      { CPA: "#006b3c" },
      {},
      ["CPA"],
      ["Robin Macadam"],
      new Map(),
      2,
      changedChangelog,
    );

    expect(html).toContain("What&#8217;s New in v2");
    expect(html).toContain("Changed (1)");
    expect(html).toContain("Time: 09:00");
  });
});