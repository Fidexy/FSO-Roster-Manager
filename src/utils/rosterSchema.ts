/**
 * Annotated JSON Schema (Draft-07) for all roster event types.
 *
 * Exported as a typed constant so it can be:
 *  - Displayed in the Settings developer-reference panel.
 *  - Imported for runtime validation (e.g. with ajv) in the future.
 *
 * The root schema is a `oneOf` discriminated union keyed on `eventType`.
 * All enum lists reflect the application defaults; operators, simulator
 * activities, and simulator codes are user-extensible in Settings.
 */

export const ROSTER_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://roster-manager/schemas/roster-event.json',
  title: 'RosterEvent',
  description:
    'A single roster calendar event. Exactly one of the four event types must be present, ' +
    'discriminated by the `eventType` field.',

  // ── Shared sub-schemas ─────────────────────────────────────────────────────
  $defs: {

    /** ISO-8601 calendar date, local timezone. */
    DateString: {
      type: 'string',
      pattern: '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$',
      description: 'Calendar date in yyyy-MM-dd format (e.g. "2025-03-14"). Local timezone.',
      examples: ['2025-03-14'],
    },

    /** 24-hour time string HH:mm. */
    TimeString: {
      type: 'string',
      pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$',
      description: '24-hour time in HH:mm format (e.g. "09:00", "23:59").',
      examples: ['09:00', '23:59'],
    },

    /**
     * Fields shared by every event type.
     * `sourceEventId` is an internal field set only on staged edits —
     * importers should omit it.
     */
    BaseEvent: {
      type: 'object',
      required: ['id', 'eventType', 'date', 'startTime', 'endTime', 'inspectors'],
      properties: {
        id: {
          type: 'string',
          description:
            'Unique event identifier. Generated automatically (UUID v4 or timestamp-based ' +
            'fallback) when an event is created. Importers may omit this field — a new id ' +
            'will be assigned on import.',
          examples: ['3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
        },
        eventType: {
          type: 'string',
          enum: ['Simulator', 'Surveillance', 'Other Duties', 'Leave'],
          description:
            'Discriminator field. Must exactly match one of the four permitted values. ' +
            'Determines which additional fields are required.',
        },
        date: {
          $ref: '#/$defs/DateString',
          description: 'The calendar date on which this event occurs.',
        },
        startTime: {
          $ref: '#/$defs/TimeString',
          description:
            'Event start time in 24-hour HH:mm format. ' +
            'Must be strictly before endTime. Blank fields default to "00:00".',
        },
        endTime: {
          $ref: '#/$defs/TimeString',
          description:
            'Event end time in 24-hour HH:mm format. ' +
            'Must be strictly after startTime. Blank fields default to "23:59".',
        },
        inspectors: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Ordered list of inspector display names (not IDs) assigned to this event. ' +
            'Names must match entries in the inspector roster stored in Settings. ' +
            'For Simulator events, at least one inspector must hold a position that is ' +
            'qualified for the chosen activity (see Qualifications in Settings). ' +
            'When multiple inspectors are shown, qualified inspectors are listed first.',
          examples: [['Robin', 'Steve']],
        },
        sourceEventId: {
          type: 'string',
          description:
            'INTERNAL — set only on staged edits. Holds the id of the original calendar ' +
            'event that will be atomically replaced when this staged item is committed. ' +
            'Importers should omit this field entirely.',
        },
      },
    },

    // ── Simulator ─────────────────────────────────────────────────────────────

    SimulatorEvent: {
      allOf: [{ $ref: '#/$defs/BaseEvent' }],
      title: 'SimulatorEvent',
      description:
        'A simulator check / training session. Requires at least one qualified inspector ' +
        'for the nominated activity.',
      required: [
        'id', 'eventType', 'date', 'startTime', 'endTime', 'inspectors',
        'operator', 'simulatorCode', 'aircraftType', 'activity', 'candidateName',
      ],
      properties: {
        eventType: {
          type: 'string',
          const: 'Simulator',
          description: 'Must be exactly "Simulator".',
        },
        operator: {
          type: 'string',
          description:
            'The airline or operator conducting the simulator session. ' +
            'Must match an entry in the operator list configured in Settings. ' +
            'Default operators (extensible): ' +
            '"AHK", "CAE HK", "CPA", "GFS", "HEL", "HGB", "HKA", "HKC", "HKE".',
          examples: ['CPA', 'HKA'],
        },
        simulatorCode: {
          type: 'string',
          description:
            'The simulator device code as configured in the Simulator Map in Settings. ' +
            'Selecting a known code auto-populates aircraftType. ' +
            'Default codes include: "CPA01", "CPA02", "CPA14" … "HK07" (see Settings → Simulator Map).',
          examples: ['CPA01', 'GFS01'],
        },
        aircraftType: {
          type: 'string',
          description:
            'Aircraft type associated with the simulator code. Auto-populated from the ' +
            'Simulator Map when a known code is selected; may be entered manually for ' +
            'unknown codes. ' +
            'Examples from the default map: "A320-200", "A330 (RR)", "B777-300ER", "EC175".',
          examples: ['A320-200', 'B777-300ER'],
        },
        activity: {
          type: 'string',
          description:
            'The type of simulator check or training being conducted. ' +
            'Must match an entry in the Simulator Activities list in Settings. ' +
            'Default activities (extensible): ' +
            '"AE Initial", "AE Renewal", "AE SBT Initial", "AE SBT Renewal", ' +
            '"AP Initial", "AP Renewal", "AP Requalification". ' +
            'The qualification check uses this field to look up permitted inspector positions.',
          enum: [
            'AE Initial', 'AE Renewal', 'AE SBT Initial', 'AE SBT Renewal',
            'AP Initial', 'AP Renewal', 'AP Requalification',
          ],
          examples: ['AE Initial'],
        },
        candidateName: {
          type: 'string',
          description:
            'Full name of the flight crew member (pilot / engineer) undergoing the check. ' +
            'Free text — not validated against any roster.',
          examples: ['Chan, Tai Man'],
        },
      },
      examples: [
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000001',
          eventType: 'Simulator',
          date: '2025-06-15',
          startTime: '09:00',
          endTime: '12:00',
          inspectors: ['Robin', 'Steve'],
          operator: 'CPA',
          simulatorCode: 'CPA01',
          aircraftType: 'A320-200',
          activity: 'AE Initial',
          candidateName: 'Chan, Tai Man',
        },
      ],
    },

    // ── Surveillance ──────────────────────────────────────────────────────────

    SurveillanceEvent: {
      allOf: [{ $ref: '#/$defs/BaseEvent' }],
      title: 'SurveillanceEvent',
      description:
        'A surveillance event (formerly "Inspection"). Covers one or more ' +
        'surveillance types (e.g. Cabin, Flight, Station, ORI, QMS Audit) with a ' +
        'single free-text details field. Legacy Inspection events (eventType ' +
        '"Inspection" with inspectionType / route / flightNo / station) are ' +
        'migrated automatically on load and import.',
      required: [
        'id', 'eventType', 'date', 'startTime', 'endTime', 'inspectors',
        'operator', 'surveillanceTypes', 'details',
      ],
      properties: {
        eventType: {
          type: 'string',
          const: 'Surveillance',
          description: 'Must be exactly "Surveillance".',
        },
        operator: {
          type: 'string',
          description:
            'The airline or operator under surveillance. ' +
            'Must match an entry in the operator list configured in Settings.',
          examples: ['CPA', 'HKA'],
        },
        surveillanceTypes: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description:
            'One or more surveillance activity types. Values should match the ' +
            'surveillance activities configured in Settings.',
          examples: [['Cabin'], ['Flight', 'Station'], ['QMS Audit']],
        },
        details: {
          type: 'string',
          description:
            'Free-text details — e.g. route and flight number ("HKG-NRT CX100"), ' +
            'station code, or audit scope. May be an empty string.',
          examples: ['HKG-NRT CX100', 'NRT', 'Annual QMS audit'],
        },
      },
      examples: [
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000002',
          eventType: 'Surveillance',
          date: '2025-06-16',
          startTime: '06:00',
          endTime: '10:00',
          inspectors: ['Norman'],
          operator: 'CPA',
          surveillanceTypes: ['Cabin'],
          details: 'HKG-NRT CX100',
        },
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000003',
          eventType: 'Surveillance',
          date: '2025-06-17',
          startTime: '09:00',
          endTime: '15:00',
          inspectors: ['Webster', 'Herick'],
          operator: 'HKA',
          surveillanceTypes: ['Station', 'SMS Assessment'],
          details: 'NRT',
        },
      ],
    },

    // ── Other Duties ──────────────────────────────────────────────────────────

    OtherDutiesEvent: {
      allOf: [{ $ref: '#/$defs/BaseEvent' }],
      title: 'OtherDutiesEvent',
      description:
        'Any duty that is not a simulator check or inspection — e.g. courses, meetings, ' +
        'overseas assignments. The subType is free text with two built-in presets.',
      required: [
        'id', 'eventType', 'date', 'startTime', 'endTime', 'inspectors',
      ],
      properties: {
        eventType: {
          type: 'string',
          const: 'Other Duties',
          description: 'Must be exactly "Other Duties".',
        },
        operator: {
          type: 'string',
          description:
            'The operator or organisation context for the duty. ' +
            'Must match an entry in the operator list configured in Settings.',
          examples: ['CPA'],
        },
        subType: {
          type: 'string',
          description:
            'The specific type of other duty. ' +
            'Preset values shown in the UI: "AEX Course", "MOR Meeting". ' +
            'Any free-text value is accepted (select "Custom" in the form).',
          examples: ['AEX Course', 'MOR Meeting', 'Recurrent Training'],
        },
        customColor: {
          type: 'string',
          pattern: '^#[0-9a-fA-F]{6}$',
          description:
            'Optional hex color override for Custom Other Duties entries. ' +
            'When omitted, the calendar uses the first selected operator color.',
          examples: ['#6b7280'],
        },
      },
      examples: [
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000004',
          eventType: 'Other Duties',
          date: '2025-06-18',
          startTime: '10:00',
          endTime: '16:00',
          inspectors: ['Robin'],
          operator: 'CPA',
          subType: 'AEX Course',
        },
      ],
    },

    // ── Leave ─────────────────────────────────────────────────────────────────

    LeaveEvent: {
      allOf: [{ $ref: '#/$defs/BaseEvent' }],
      title: 'LeaveEvent',
      description:
        'An inspector\'s leave or absence. Leave events have no operator — they are shown ' +
        'in a neutral dark-slate colour and sorted last on the calendar. ' +
        'The inspector filter matches on the inspectors array.',
      required: [
        'id', 'eventType', 'date', 'startTime', 'endTime', 'inspectors', 'leaveType',
      ],
      properties: {
        eventType: {
          type: 'string',
          const: 'Leave',
          description: 'Must be exactly "Leave".',
        },
        leaveType: {
          type: 'string',
          description:
            'The category of leave. ' +
            'Preset values shown in the UI: "VL" (vacation leave), "MA" (maternity/paternity), ' +
            '"TOIL" (time off in lieu), "Overseas Duties". ' +
            'Any free-text value is accepted (select "Custom" in the form).',
          examples: ['VL', 'MA', 'TOIL', 'Overseas Duties', 'Study Leave'],
        },
      },
      examples: [
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000005',
          eventType: 'Leave',
          date: '2025-06-19',
          startTime: '00:00',
          endTime: '23:59',
          inspectors: ['Li'],
          leaveType: 'VL',
        },
      ],
    },

  }, // end $defs

  // ── Root: discriminated union ──────────────────────────────────────────────
  oneOf: [
    { $ref: '#/$defs/SimulatorEvent' },
    { $ref: '#/$defs/SurveillanceEvent' },
    { $ref: '#/$defs/OtherDutiesEvent' },
    { $ref: '#/$defs/LeaveEvent' },
  ],

  examples: [
    // One example of each type in a single JSON array (as exported in roster-backup JSON files)
    [
      {
        id: 'a1b2c3d4-0000-0000-0000-000000000001',
        eventType: 'Simulator',
        date: '2025-06-15',
        startTime: '09:00',
        endTime: '12:00',
        inspectors: ['Robin', 'Steve'],
        operator: 'CPA',
        simulatorCode: 'CPA01',
        aircraftType: 'A320-200',
        activity: 'AE Initial',
        candidateName: 'Chan, Tai Man',
      },
      {
        id: 'a1b2c3d4-0000-0000-0000-000000000002',
        eventType: 'Surveillance',
        date: '2025-06-16',
        startTime: '06:00',
        endTime: '10:00',
        inspectors: ['Norman'],
        operator: 'CPA',
        surveillanceTypes: ['Cabin'],
        details: 'HKG-NRT CX100',
      },
      {
        id: 'a1b2c3d4-0000-0000-0000-000000000004',
        eventType: 'Other Duties',
        date: '2025-06-18',
        startTime: '10:00',
        endTime: '16:00',
        inspectors: ['Robin'],
        operator: 'CPA',
        subType: 'AEX Course',
      },
      {
        id: 'a1b2c3d4-0000-0000-0000-000000000005',
        eventType: 'Leave',
        date: '2025-06-19',
        startTime: '00:00',
        endTime: '23:59',
        inspectors: ['Li'],
        leaveType: 'VL',
      },
    ],
  ],
} as const;

export type RosterSchema = typeof ROSTER_SCHEMA;
