import { Bell, BellOff, BellRing, Loader2, Play, RefreshCw, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import { playChatCompletionSound } from '../../../../utils/notificationSound';
import type { NotificationPreferencesState } from '../../types/types';

type NotificationsSettingsTabProps = {
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  pushPermission: NotificationPermission | 'unsupported';
  isPushSubscribed: boolean;
  isPushLoading: boolean;
  onEnablePush: () => void;
  onDisablePush: () => void;
};

export default function NotificationsSettingsTab({
  notificationPreferences,
  onNotificationPreferencesChange,
  pushPermission,
  isPushSubscribed,
  isPushLoading,
  onEnablePush,
  onDisablePush,
}: NotificationsSettingsTabProps) {
  const { t } = useTranslation('settings');
  const [manualStatus, setManualStatus] = useState<string>('');
  const [manualLoading, setManualLoading] = useState(false);

  const pushSupported = pushPermission !== 'unsupported';
  const pushDenied = pushPermission === 'denied';

  const handleManualSubscribe = async () => {
    setManualLoading(true);
    setManualStatus('Starting...');
    try {
      setManualStatus('Requesting permission...');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setManualStatus(`Permission denied: ${perm}`);
        return;
      }
      setManualStatus('Permission granted. Getting VAPID key...');
      const keyRes = await authenticatedFetch('/api/settings/push/vapid-public-key');
      const keyData = await keyRes.json();
      if (!keyData.publicKey) {
        setManualStatus('Error: No VAPID public key from server');
        return;
      }
      setManualStatus('VAPID key received. Waiting for service worker...');
      const registration = await navigator.serviceWorker.ready;
      setManualStatus('Service worker ready. Subscribing to push...');

      const padding = '='.repeat((4 - (keyData.publicKey.length % 4)) % 4);
      const base64 = (keyData.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const appServerKey = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) appServerKey[i] = rawData.charCodeAt(i);

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey.buffer as ArrayBuffer,
      });
      setManualStatus('Push subscription created. Sending to server...');

      const subJson = subscription.toJSON();
      const saveRes = await authenticatedFetch('/api/settings/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys }),
      });
      const saveData = await saveRes.json();
      if (saveData.success) {
        setManualStatus('Done! Push notifications active.');
      } else {
        setManualStatus(`Server error: ${JSON.stringify(saveData)}`);
      }
    } catch (err: any) {
      setManualStatus(`Error: ${err?.message || String(err)}`);
    } finally {
      setManualLoading(false);
    }
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Bell className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-medium text-foreground">{t('notifications.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('notifications.description')}</p>
      </div>

      <div className="space-y-4 bg-card border border-border rounded-lg p-4">
        <h4 className="font-medium text-foreground">{t('notifications.webPush.title')}</h4>
        {!pushSupported ? (
          <p className="text-sm text-muted-foreground">{t('notifications.webPush.unsupported')}</p>
        ) : pushDenied ? (
          <p className="text-sm text-muted-foreground">{t('notifications.webPush.denied')}</p>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isPushLoading}
              onClick={() => {
                if (isPushSubscribed) {
                  onDisablePush();
                } else {
                  onEnablePush();
                }
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isPushSubscribed
                  ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
                  : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
              }`}
            >
              {isPushLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPushSubscribed ? (
                <BellOff className="w-4 h-4" />
              ) : (
                <BellRing className="w-4 h-4" />
              )}
              {isPushLoading
                ? t('notifications.webPush.loading')
                : isPushSubscribed
                  ? t('notifications.webPush.disable')
                  : t('notifications.webPush.enable')}
            </button>
            {isPushSubscribed && (
              <span className="text-sm text-green-600 dark:text-green-400">
                {t('notifications.webPush.enabled')}
              </span>
            )}
            {isPushSubscribed && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { authenticatedFetch: authFetch } = await import('../../../../utils/api');
                    await authFetch('/api/settings/push/test', { method: 'POST' });
                  } catch (error) {
                    console.error('Failed to send test push notification', error);
                  }
                }}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <Bell className="w-4 h-4" />
                Test
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 bg-card border border-border rounded-lg p-4">
        <h4 className="font-medium text-foreground">Manual Push Setup</h4>
        <p className="text-xs text-muted-foreground">
          Use this if the Enable button above doesn't work on your device.
        </p>
        <button
          type="button"
          disabled={manualLoading}
          onClick={handleManualSubscribe}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {manualLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {manualLoading ? 'Working...' : 'Force Subscribe'}
        </button>
        {manualStatus && (
          <p className={`text-xs font-mono p-2 rounded ${manualStatus.startsWith('Error') || manualStatus.startsWith('Permission denied') ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400' : manualStatus.startsWith('Done') ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
            {manualStatus}
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-blue-600" />
              <h4 className="font-medium text-foreground">
                {t('notifications.sound.title', { defaultValue: 'Sound' })}
              </h4>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('notifications.sound.description', {
                defaultValue: 'Play a short tone when a chat run finishes.',
              })}
            </p>
          </div>

          <label className="flex shrink-0 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={notificationPreferences.channels.sound}
              onChange={(event) =>
                onNotificationPreferencesChange({
                  ...notificationPreferences,
                  channels: {
                    ...notificationPreferences.channels,
                    sound: event.target.checked,
                  },
                })
              }
              className="h-4 w-4"
            />
            {t('notifications.sound.enabled', { defaultValue: 'Enabled' })}
          </label>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void playChatCompletionSound({ force: true });
          }}
        >
          <Play className="h-4 w-4" />
          {t('notifications.sound.test', { defaultValue: 'Test sound' })}
        </Button>
      </div>

      <div className="space-y-4 bg-card border border-border rounded-lg p-4">
        <h4 className="font-medium text-foreground">{t('notifications.events.title')}</h4>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={notificationPreferences.events.actionRequired}
              onChange={(event) =>
                onNotificationPreferencesChange({
                  ...notificationPreferences,
                  events: {
                    ...notificationPreferences.events,
                    actionRequired: event.target.checked,
                  },
                })
              }
              className="w-4 h-4"
            />
            {t('notifications.events.actionRequired')}
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={notificationPreferences.events.stop}
              onChange={(event) =>
                onNotificationPreferencesChange({
                  ...notificationPreferences,
                  events: {
                    ...notificationPreferences.events,
                    stop: event.target.checked,
                  },
                })
              }
              className="w-4 h-4"
            />
            {t('notifications.events.stop')}
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={notificationPreferences.events.error}
              onChange={(event) =>
                onNotificationPreferencesChange({
                  ...notificationPreferences,
                  events: {
                    ...notificationPreferences.events,
                    error: event.target.checked,
                  },
                })
              }
              className="w-4 h-4"
            />
            {t('notifications.events.error')}
          </label>
        </div>
      </div>
    </div>
  );
}
