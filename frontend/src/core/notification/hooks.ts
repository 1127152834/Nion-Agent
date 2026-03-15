import { useState, useEffect, useCallback, useRef } from "react";

import { useLocalSettings } from "../settings";

const DEFAULT_NOTIFICATION_ICON_PATH = "/images/nion-notification.png";

interface NotificationOptions {
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: unknown;
  requireInteraction?: boolean;
  silent?: boolean;
}

interface UseNotificationReturn {
  permission: NotificationPermission;
  isSupported: boolean;
  requestPermission: () => Promise<NotificationPermission>;
  showNotification: (title: string, options?: NotificationOptions) => void;
}

export function useNotification(): UseNotificationReturn {
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [isSupported, setIsSupported] = useState(false);

  const lastNotificationTime = useRef<Date>(new Date());

  useEffect(() => {
    // Check if browser supports Notification API
    if ("Notification" in window) {
      setIsSupported(true);
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission =
    useCallback(async (): Promise<NotificationPermission> => {
      if (!isSupported) {
        console.warn("Notification API is not supported in this browser");
        return "denied";
      }

      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    }, [isSupported]);

  const [settings] = useLocalSettings();

  const showNotification = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!isSupported) {
        console.warn("Notification API is not supported");
        return;
      }

      if (!settings.notification.enabled) {
        console.warn("Notification is disabled");
        return;
      }

      if (
        new Date().getTime() - lastNotificationTime.current.getTime() <
        1000
      ) {
        console.warn("Notification sent too soon");
        return;
      }
      lastNotificationTime.current = new Date();

      if (permission !== "granted") {
        console.warn("Notification permission not granted");
        return;
      }

      // 未显式指定 icon 时，部分平台会回退到 favicon，导致通知图标不一致。
      const resolvedOptions: NotificationOptions = {
        ...options,
        icon: options?.icon ?? DEFAULT_NOTIFICATION_ICON_PATH,
      };

      const notification = new Notification(title, resolvedOptions);

      // Optional: Add event listeners
      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      notification.onerror = (error) => {
        console.error("Notification error:", error);
      };
    },
    [isSupported, settings.notification.enabled, permission],
  );

  return {
    permission,
    isSupported,
    requestPermission,
    showNotification,
  };
}
