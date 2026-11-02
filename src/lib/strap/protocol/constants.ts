/**
 * WHOOP strap BLE protocol constants.
 *
 * Every number here is a protocol fact (UUID, packet/command/event number, byte
 * offset) taken from the NOOP protocol documentation, which states those facts
 * are freely reusable. No NOOP code was copied. Sources are cited per block as
 * `doc file § section`. Nothing in this module has been exercised against a
 * real strap by FRADY OS; see README.md in this directory.
 */

/** Which wire profile a strap speaks. "Harvard" (4.0) vs "puffin" (5.0 / MG). */
export type StrapFamily = "whoop4" | "whoop5";

// ---------------------------------------------------------------------------
// GATT — WHOOP 4.0
// Source: PROTOCOL_WHOOP4.md § "WHOOP 4 — service 61080001-…"
// ---------------------------------------------------------------------------
export const WHOOP4_SERVICE = "61080001-8d6d-82b8-614a-1c8cb0f8dcc6";
/** app → strap: command frames (type 35). */
export const WHOOP4_CMD_WRITE = "61080002-8d6d-82b8-614a-1c8cb0f8dcc6";
/** strap → app: command responses (type 36). */
export const WHOOP4_CMD_RESPONSE = "61080003-8d6d-82b8-614a-1c8cb0f8dcc6";
/** strap → app: events (type 48). */
export const WHOOP4_EVENT = "61080004-8d6d-82b8-614a-1c8cb0f8dcc6";
/** strap → app: fragmented data frames (types 40/43/47/49/50 …). */
export const WHOOP4_DATA = "61080005-8d6d-82b8-614a-1c8cb0f8dcc6";

// ---------------------------------------------------------------------------
// GATT — WHOOP 5.0 / MG
// Source: PROTOCOL_WHOOP5.md § "WHOOP 5/MG — service fd4b0001-…"
// ---------------------------------------------------------------------------
export const WHOOP5_SERVICE = "fd4b0001-cce1-4033-93ce-002d5875f58a";
export const WHOOP5_CMD_WRITE = "fd4b0002-cce1-4033-93ce-002d5875f58a";
export const WHOOP5_NOTIFY_0003 = "fd4b0003-cce1-4033-93ce-002d5875f58a";
export const WHOOP5_NOTIFY_0004 = "fd4b0004-cce1-4033-93ce-002d5875f58a";
export const WHOOP5_NOTIFY_0005 = "fd4b0005-cce1-4033-93ce-002d5875f58a";
export const WHOOP5_NOTIFY_0007 = "fd4b0007-cce1-4033-93ce-002d5875f58a";

// ---------------------------------------------------------------------------
// GATT — standard SIG services (both generations)
// Source: PROTOCOL_CONCEPTS.md § "Standard SIG services"; PROTOCOL_WHOOP5.md
// § "WHOOP 5.0 vs MG — telling the hardware apart" (DIS strings).
// ---------------------------------------------------------------------------
export const HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
export const HEART_RATE_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb";
export const BATTERY_SERVICE = "0000180f-0000-1000-8000-00805f9b34fb";
export const BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb";
export const DEVICE_INFORMATION_SERVICE = "0000180a-0000-1000-8000-00805f9b34fb";
/** WHOOP 5.0 / MG only: WHOOP 4 exposes no DIS serial (PROTOCOL_WHOOP4.md § GET_HELLO_HARVARD). */
export const DIS_MODEL_NUMBER = "00002a24-0000-1000-8000-00805f9b34fb";
export const DIS_SERIAL_NUMBER = "00002a25-0000-1000-8000-00805f9b34fb";
export const DIS_HARDWARE_REVISION = "00002a27-0000-1000-8000-00805f9b34fb";

export interface FamilyGatt {
  service: string;
  commandWrite: string;
  /** Notify characteristics the transport must subscribe to before the bond write. */
  notify: readonly string[];
}

export const FAMILY_GATT: Record<StrapFamily, FamilyGatt> = {
  whoop4: {
    service: WHOOP4_SERVICE,
    commandWrite: WHOOP4_CMD_WRITE,
    notify: [WHOOP4_CMD_RESPONSE, WHOOP4_EVENT, WHOOP4_DATA],
  },
  whoop5: {
    service: WHOOP5_SERVICE,
    commandWrite: WHOOP5_CMD_WRITE,
    // PROTOCOL_WHOOP5.md § "Connection and frame format": subscribe fd4b 0003/0004/0005/0007, then hello.
    notify: [WHOOP5_NOTIFY_0003, WHOOP5_NOTIFY_0004, WHOOP5_NOTIFY_0005, WHOOP5_NOTIFY_0007],
  },
};

/** Maps a service or characteristic UUID (any case) to the family it belongs to, or null. */
export function familyForUuid(uuid: string): StrapFamily | null {
  const u = uuid.toLowerCase();
  if (u.startsWith("6108000")) return "whoop4";
  if (u.startsWith("fd4b000")) return "whoop5";
  return null;
}

// ---------------------------------------------------------------------------
// Packet types (byte 4 of a WHOOP 4 frame, byte 8 of a WHOOP 5 format-1 frame)
// Source: whoop_protocol.json enums.PacketType; PROTOCOL_IMPLEMENTATION.md § PacketType.
// ---------------------------------------------------------------------------
export const PacketType = {
  COMMAND: 35,
  COMMAND_RESPONSE: 36,
  PUFFIN_COMMAND: 37,
  PUFFIN_COMMAND_RESPONSE: 38,
  REALTIME_DATA: 40,
  REALTIME_RAW_DATA: 43,
  HISTORICAL_DATA: 47,
  EVENT: 48,
  METADATA: 49,
  CONSOLE_LOGS: 50,
  REALTIME_IMU_DATA_STREAM: 51,
  HISTORICAL_IMU_DATA_STREAM: 52,
  RELATIVE_PUFFIN_EVENTS: 53,
  PUFFIN_EVENTS_FROM_STRAP: 54,
  RELATIVE_BATTERY_PACK_CONSOLE_LOGS: 55,
  PUFFIN_METADATA: 56,
} as const;
export type PacketTypeValue = (typeof PacketType)[keyof typeof PacketType];

/** Packet types that count as offload liveness (PROTOCOL_IMPLEMENTATION.md § Watchdog & liveness). */
export const OFFLOAD_PACKET_TYPES: ReadonlySet<number> = new Set([
  PacketType.HISTORICAL_DATA,
  PacketType.EVENT,
  PacketType.METADATA,
  PacketType.CONSOLE_LOGS,
  PacketType.HISTORICAL_IMU_DATA_STREAM,
  PacketType.PUFFIN_METADATA,
]);

// Source: whoop_protocol.json enums.MetadataType
export const MetadataType = {
  HISTORY_START: 1,
  HISTORY_END: 2,
  HISTORY_COMPLETE: 3,
} as const;

// Source: whoop_protocol.json enums.CommandResult; PROTOCOL_TRANSPORT.md § "Responses and correlation"
export const CommandResult = {
  FAILURE: 0,
  SUCCESS: 1,
  PENDING: 2,
  UNSUPPORTED: 3,
} as const;

export function commandResultName(result: number): string {
  switch (result) {
    case CommandResult.FAILURE:
      return "FAILURE";
    case CommandResult.SUCCESS:
      return "SUCCESS";
    case CommandResult.PENDING:
      return "PENDING";
    case CommandResult.UNSUPPORTED:
      return "UNSUPPORTED";
    default:
      return `UNKNOWN(${result})`;
  }
}

// ---------------------------------------------------------------------------
// Event numbers (type 48). Source: whoop_protocol.json enums.EventNumber (complete list).
// ---------------------------------------------------------------------------
export const EventId = {
  UNDEFINED: 0,
  ERROR: 1,
  CONSOLE_OUTPUT: 2,
  BATTERY_LEVEL: 3,
  SYSTEM_CONTROL: 4,
  EXTERNAL_5V_ON: 5,
  EXTERNAL_5V_OFF: 6,
  CHARGING_ON: 7,
  CHARGING_OFF: 8,
  WRIST_ON: 9,
  WRIST_OFF: 10,
  BLE_CONNECTION_UP: 11,
  BLE_CONNECTION_DOWN: 12,
  RTC_LOST: 13,
  DOUBLE_TAP: 14,
  BOOT: 15,
  SET_RTC: 16,
  TEMPERATURE_LEVEL: 17,
  PAIRING_MODE: 18,
  SERIAL_HEAD_CONNECTED: 19,
  SERIAL_HEAD_REMOVED: 20,
  BATTERY_PACK_CONNECTED: 21,
  BATTERY_PACK_REMOVED: 22,
  BLE_BONDED: 23,
  BLE_HR_PROFILE_ENABLED: 24,
  BLE_HR_PROFILE_DISABLED: 25,
  TRIM_ALL_DATA: 26,
  TRIM_ALL_DATA_ENDED: 27,
  FLASH_INIT_COMPLETE: 28,
  STRAP_CONDITION_REPORT: 29,
  BOOT_REPORT: 30,
  EXIT_VIRGIN_MODE: 31,
  CAPTOUCH_AUTOTHRESHOLD_ACTION: 32,
  BLE_REALTIME_HR_ON: 33,
  BLE_REALTIME_HR_OFF: 34,
  ACCELEROMETER_RESET: 35,
  AFE_RESET: 36,
  SHIP_MODE_ENABLED: 37,
  SHIP_MODE_DISABLED: 38,
  SHIP_MODE_BOOT: 39,
  CH1_SATURATION_DETECTED: 40,
  CH2_SATURATION_DETECTED: 41,
  ACCELEROMETER_SATURATION_DETECTED: 42,
  BLE_SYSTEM_RESET: 43,
  BLE_SYSTEM_ON: 44,
  BLE_SYSTEM_INITIALIZED: 45,
  RAW_DATA_COLLECTION_ON: 46,
  RAW_DATA_COLLECTION_OFF: 47,
  STRAP_DRIVEN_ALARM_SET: 56,
  STRAP_DRIVEN_ALARM_EXECUTED: 57,
  APP_DRIVEN_ALARM_EXECUTED: 58,
  STRAP_DRIVEN_ALARM_DISABLED: 59,
  HAPTICS_FIRED: 60,
  EXTENDED_BATTERY_INFORMATION: 63,
  HIGH_FREQ_SYNC_PROMPT: 96,
  HIGH_FREQ_SYNC_ENABLED: 97,
  HIGH_FREQ_SYNC_DISABLED: 98,
  HAPTICS_TERMINATED: 100,
} as const;

const EVENT_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(EventId).map(([name, id]) => [id, name] as const),
);

/** Names only come from the schema enum; unknown ids stay raw (BLE_REVERSE_ENGINEERING.md § "Enum-drift guard"). */
export function eventName(id: number): string {
  return EVENT_NAMES.get(id) ?? `0x${id.toString(16).toUpperCase().padStart(2, "0")}(${id})`;
}

// ---------------------------------------------------------------------------
// Command numbers (byte 6 of a WHOOP 4 type-35 frame, byte 10 on WHOOP 5).
// Source: whoop_protocol.json enums.CommandNumber, cross-checked with
// PROTOCOL_COMMANDS.md § "Canonical command matrix". Only the commands this
// layer sends or decodes are listed; destructive ids live in FORBIDDEN_COMMANDS.
// ---------------------------------------------------------------------------
export const Command = {
  TOGGLE_REALTIME_HR: 3,
  REPORT_VERSION_INFO: 7,
  /**
   * JSON names 10/11 `SET_CLOCK`/`GET_CLOCK`; PROTOCOL_COMMANDS.md names the
   * same ids `SET_CLOCK_DEPRECATED`/`GET_CLOCK_DEPRECATED` in the WHOOP 5 column.
   * The number is the same in both sources; the JSON name is kept here.
   */
  SET_CLOCK: 10,
  GET_CLOCK: 11,
  ABORT_HISTORICAL_TRANSMITS: 20,
  SEND_HISTORICAL_DATA: 22,
  HISTORICAL_DATA_RESULT: 23,
  GET_BATTERY_LEVEL: 26,
  GET_DATA_RANGE: 34,
  GET_HELLO_HARVARD: 35,
  SEND_R10_R11_REALTIME: 63,
  GET_ADVERTISING_NAME_HARVARD: 76,
  GET_EXTENDED_BATTERY_INFO: 98,
  /** WHOOP 5/MG hello; the fixed CLIENT_HELLO frame is this command, revision 1. */
  GET_HELLO: 145,
  /**
   * WHOOP 5/MG revision-1 clock pair. Not present in whoop_protocol.json's
   * CommandNumber enum; the ids come from PROTOCOL_COMMANDS.md § matrix rows
   * 146/147 and PROTOCOL_TRANSPORT.md § "Clock and identity contracts".
   */
  SET_CLOCK_V5: 146,
  GET_CLOCK_V5: 147,
} as const;
export type CommandValue = (typeof Command)[keyof typeof Command];

const COMMAND_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(Command).map(([name, id]) => [id, name] as const),
);

export function commandName(id: number): string {
  return COMMAND_NAMES.get(id) ?? `CMD_${id}`;
}

/**
 * Safety rule: these ids are never built, sent or exposed by this layer.
 * Source: PROTOCOL_IMPLEMENTATION.md § "Destructive commands — do not send"
 * and PROTOCOL_COMMANDS.md § "Service and sensitive operations". Ship mode has
 * events (37/38/39) but no documented command id, so nothing to list for it.
 */
export const FORBIDDEN_COMMANDS: ReadonlySet<number> = new Set([
  15, // FORGET_BONDS — pairing reset
  25, // FORCE_TRIM — invasive history reclamation
  29, // REBOOT_STRAP
  32, // POWER_CYCLE_STRAP
  33, // SET_READ_POINTER — invasive cursor mutation
  36, // START_FIRMWARE_LOAD
  37, // LOAD_FIRMWARE_DATA
  38, // PROCESS_FIRMWARE_IMAGE
  45, // ENTER_BLE_DFU
  83, // VERIFY_FIRMWARE_IMAGE (part of the update flow)
  99, // RESET_FUEL_GAUGE
  142, // START_FIRMWARE_LOAD_NEW
  143, // LOAD_FIRMWARE_DATA_NEW
  144, // PROCESS_FIRMWARE_IMAGE_NEW
  155, // START_CERTIFICATE_TRANSFER
  156, // LOAD_CERTIFICATE
  157, // VERIFY_CERTIFICATE
  158, // PROCESS_CERTIFICATE
  159, // LOCK_DEVICE
]);

// ---------------------------------------------------------------------------
// Framing constants
// Source: PROTOCOL_WHOOP4.md § "WHOOP 4 envelope"; PROTOCOL_TRANSPORT.md § "Format 1 framing";
// BLE_REVERSE_ENGINEERING.md § 2 (minimum sizes, reassembler ceiling).
// ---------------------------------------------------------------------------
export const SOF = 0xaa;
/** WHOOP 5 format byte at offset 1. */
export const WHOOP5_FORMAT_1 = 0x01;
/** Zero-payload WHOOP 4 command: declared length 7, complete size 11. */
export const WHOOP4_MIN_FRAME = 11;
/** NOOP's documented 5.0 acceptance floor (8 header + type + 4 CRC); the firmware's own inbound rule is > 15. */
export const WHOOP5_MIN_FRAME = 13;
/** Smallest frame the WHOOP 5 firmware accepts inbound (PROTOCOL_TRANSPORT.md § Format 1). */
export const WHOOP5_MIN_OUTBOUND_FRAME = 16;
/** Reassembler ceiling (PROTOCOL_IMPLEMENTATION.md § Reassembly: `maxFrameBytes`, 8192). */
export const MAX_FRAME_BYTES = 8192;
/** Offset of the inner record (type byte) in a complete frame, per family. */
export const INNER_OFFSET: Record<StrapFamily, number> = { whoop4: 4, whoop5: 8 };

/**
 * The fixed WHOOP 5/MG session-start frame: a type-35 COMMAND, seq 1,
 * GET_HELLO (145) revision 1, CRC16-Modbus header + CRC32 trailer.
 * Source: PROTOCOL_WHOOP5.md § "Connection and frame format".
 */
export const CLIENT_HELLO_FRAME: Uint8Array = Uint8Array.from([
  0xaa, 0x01, 0x08, 0x00, 0x00, 0x01, 0xe6, 0x71, 0x23, 0x01, 0x91, 0x01, 0x36, 0x3e, 0x5c, 0x8d,
]);
export const CLIENT_HELLO_SEQ = 1;

/** Plausibility window for a Unix-seconds field (2015-01-01 .. 2040-ish). Application policy, not protocol. */
export const MIN_PLAUSIBLE_UNIX = 1_420_070_400;
export const MAX_PLAUSIBLE_UNIX = 2_200_000_000;
