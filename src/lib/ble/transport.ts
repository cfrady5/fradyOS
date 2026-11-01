import { Capacitor } from "@capacitor/core";
import { BATTERY_LEVEL, BATTERY_SERVICE, HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE, parseHeartRateMeasurement, type HeartRateMeasurement } from "./heartRate";

/**
 * Two ways to reach the strap's Heart Rate Service: Web Bluetooth in Chrome (Android and desktop),
 * and the Capacitor Bluetooth plugin inside the iOS / Android app. Both hand back the same stream.
 */
export type BluetoothSupport = "web" | "native" | "none";

export function bluetoothSupport(): BluetoothSupport {
  if (typeof window === "undefined") return "none";
  if (Capacitor.isNativePlatform()) return "native";
  if ("bluetooth" in navigator && navigator.bluetooth) return "web";
  return "none";
}

export interface ConnectedStrap {
  name: string;
  /** Battery percentage when the device exposes the Battery Service. */
  battery: number | null;
  disconnect: () => Promise<void>;
}

export interface ConnectOptions {
  onMeasurement: (m: HeartRateMeasurement) => void;
  onDisconnect: () => void;
}

export async function connectStrap(opts: ConnectOptions): Promise<ConnectedStrap> {
  const support = bluetoothSupport();
  if (support === "native") return connectNative(opts);
  if (support === "web") return connectWeb(opts);
  throw new Error("Bluetooth is not available in this browser.");
}

async function connectWeb({ onMeasurement, onDisconnect }: ConnectOptions): Promise<ConnectedStrap> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [HEART_RATE_SERVICE] }],
    optionalServices: [BATTERY_SERVICE],
  });
  if (!device.gatt) throw new Error("This device does not expose a GATT server.");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(HEART_RATE_SERVICE);
  const characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
  characteristic.addEventListener("characteristicvaluechanged", (event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (value) onMeasurement(parseHeartRateMeasurement(value));
  });
  await characteristic.startNotifications();
  device.addEventListener("gattserverdisconnected", onDisconnect, { once: true });

  let battery: number | null = null;
  try {
    const batteryService = await server.getPrimaryService(BATTERY_SERVICE);
    const level = await (await batteryService.getCharacteristic(BATTERY_LEVEL)).readValue();
    battery = level.byteLength ? level.getUint8(0) : null;
  } catch {
    battery = null;
  }

  return {
    name: device.name ?? "Heart rate strap",
    battery,
    disconnect: async () => {
      device.removeEventListener("gattserverdisconnected", onDisconnect);
      try {
        await characteristic.stopNotifications();
      } catch {
        // Already gone.
      }
      device.gatt?.disconnect();
    },
  };
}

async function connectNative({ onMeasurement, onDisconnect }: ConnectOptions): Promise<ConnectedStrap> {
  const { BleClient } = await import("@capacitor-community/bluetooth-le");
  await BleClient.initialize({ androidNeverForLocation: true });
  const device = await BleClient.requestDevice({ services: [HEART_RATE_SERVICE], optionalServices: [BATTERY_SERVICE] });
  await BleClient.connect(device.deviceId, () => onDisconnect());
  await BleClient.startNotifications(device.deviceId, HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, (value) => onMeasurement(parseHeartRateMeasurement(value)));

  let battery: number | null = null;
  try {
    const level = await BleClient.read(device.deviceId, BATTERY_SERVICE, BATTERY_LEVEL);
    battery = level.byteLength ? level.getUint8(0) : null;
  } catch {
    battery = null;
  }

  return {
    name: device.name ?? "Heart rate strap",
    battery,
    disconnect: async () => {
      try {
        await BleClient.stopNotifications(device.deviceId, HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT);
      } catch {
        // Already gone.
      }
      await BleClient.disconnect(device.deviceId).catch(() => undefined);
    },
  };
}
