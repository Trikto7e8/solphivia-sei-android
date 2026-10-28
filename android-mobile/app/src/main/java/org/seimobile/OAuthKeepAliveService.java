package org.seimobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/** Keeps the loopback OAuth callback listener alive while the system browser is open. */
public final class OAuthKeepAliveService extends Service {
  private static final String CHANNEL = "oauth_link";
  private static final int NOTIFICATION_ID = 2;

  @Override
  public void onCreate() {
    super.onCreate();
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (Build.VERSION.SDK_INT >= 26)
      manager.createNotificationChannel(
          new NotificationChannel(
              CHANNEL, "Collegamento ChatGPT", NotificationManager.IMPORTANCE_LOW));
    PendingIntent open =
        PendingIntent.getActivity(
            this,
            2,
            new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification note;
    if (Build.VERSION.SDK_INT >= 26) {
      note =
          new Notification.Builder(this, CHANNEL)
              .setSmallIcon(android.R.drawable.ic_dialog_info)
              .setContentTitle("Collegamento ChatGPT in corso")
              .setContentText("Completa l’autorizzazione nel browser, poi torna a Sei Mobile.")
              .setContentIntent(open)
              .setOngoing(true)
              .build();
    } else {
      note =
          new Notification.Builder(this)
              .setSmallIcon(android.R.drawable.ic_dialog_info)
              .setContentTitle("Collegamento ChatGPT in corso")
              .setContentText("Completa l’autorizzazione nel browser, poi torna a Sei Mobile.")
              .setContentIntent(open)
              .setOngoing(true)
              .build();
    }
    if (Build.VERSION.SDK_INT >= 34)
      startForeground(
          NOTIFICATION_ID,
          note,
          android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
    else startForeground(NOTIFICATION_ID, note);
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    return START_NOT_STICKY;
  }

  @Override
  public void onDestroy() {
    stopForeground(true);
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
