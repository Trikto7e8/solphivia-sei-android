package org.seimobile;

import android.app.*;
import android.content.*;
import android.os.Bundle;
import android.widget.*;
import java.lang.reflect.*;
import java.util.*;

/** On-device regressions; preserves local conversation and never signs in. */
public final class SmokeInstrumentation extends Instrumentation {
  @Override
  public void onCreate(Bundle args) {
    super.onCreate(args);
    start();
  }

  private Activity activity;
  private int passed;

  private void check(boolean value, String name) {
    if (!value) throw new AssertionError(name);
    passed++;
    Bundle b = new Bundle();
    b.putString("stream", "PASS " + name + "\n");
    sendStatus(0, b);
  }

  private Activity open() {
    return startActivitySync(
        new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  }

  @Override
  public void onStart() {
    android.content.SharedPreferences prefs =
        getTargetContext().getSharedPreferences("sei_mobile", 0);
    Map<String, ?> original = new HashMap<>(prefs.getAll());
    Bundle result = new Bundle();
    try {
      activity = open();
      runOnMainSync(
          () -> {
            ((EditText) activity.findViewById(R.id.message_input)).setText("draft-regression-2026");
            activity.finish();
          });
      waitForIdleSync();
      activity = open();
      runOnMainSync(
          () ->
              check(
                  "draft-regression-2026"
                      .equals(
                          ((EditText) activity.findViewById(R.id.message_input))
                              .getText()
                              .toString()),
                  "draft survives activity restart"));
      runOnMainSync(
          () -> {
            activity.findViewById(R.id.configure_companion).performClick();
            ((EditText) activity.findViewById(R.id.companion_name)).setText("Test Companion");
            ((EditText) activity.findViewById(R.id.companion_persona)).setText("Curioso e calmo");
            activity.findViewById(R.id.save_companion).performClick();
          });
      check(
          "Test Companion".equals(prefs.getString("name", "")), "companion configuration persists");
      boolean oldAuth = ChatGptClient.isAuthorizing();
      runOnMainSync(
          () -> {
            ((EditText) activity.findViewById(R.id.message_input)).setText("   ");
            activity.findViewById(R.id.send_message).performClick();
          });
      check(oldAuth == ChatGptClient.isAuthorizing(), "empty message never opens authorization");
      Method validate =
          ChatGptClient.class.getDeclaredMethod(
              "validateIdToken", String.class, String.class, String.class);
      validate.setAccessible(true);
      boolean rejected = false;
      try {
        validate.invoke(null, "malformed", "test-client", "test-nonce");
      } catch (InvocationTargetException e) {
        rejected = e.getCause() instanceof SecurityException;
      }
      check(rejected, "malformed identity token rejected");
      char[] board = new char[9]; java.util.Arrays.fill(board, ' ');
      check(unbeatable(board), "companion never loses across every reachable player sequence");
      Method put =
          ChatGptClient.class.getDeclaredMethod(
              "putSecret", Context.class, String.class, String.class);
      put.setAccessible(true);
      Method get = ChatGptClient.class.getDeclaredMethod("secret", Context.class, String.class);
      get.setAccessible(true);
      put.invoke(null, getTargetContext(), "test_probe", "synthetic-test-value");
      String stored =
          getTargetContext()
              .getSharedPreferences("chatgpt_oauth", 0)
              .getString("enc_test_probe", "");
      check(
          !stored.isEmpty()
              && !stored.contains("synthetic-test-value")
              && "synthetic-test-value".equals(get.invoke(null, getTargetContext(), "test_probe")),
          "credential encryption round-trip");
      runOnMainSync(() -> activity.finish()); waitForIdleSync();
      activity = startActivitySync(new Intent(getTargetContext(), GameActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      Field gameBoard = GameActivity.class.getDeclaredField("board"); gameBoard.setAccessible(true);
      char[] previous = ((char[])gameBoard.get(activity)).clone();
      Method play = GameActivity.class.getDeclaredMethod("play", int.class); play.setAccessible(true);
      runOnMainSync(() -> {
        try { char[] freshBoard = new char[9]; Arrays.fill(freshBoard, ' '); gameBoard.set(activity, freshBoard); play.invoke(activity, 0); }
        catch (Exception e) { throw new RuntimeException(e); }
      });
      char[] played = (char[])gameBoard.get(activity); int crosses=0,circles=0;
      for(char c:played){if(c=='X')crosses++;if(c=='O')circles++;}
      check(crosses==1&&circles==1,"game UI responds with exactly one companion move");
      Thread.sleep(1500);
      android.graphics.Bitmap shot=getUiAutomation().takeScreenshot();
      java.io.File gameShot=new java.io.File(getTargetContext().getExternalFilesDir(null),"game-preview.png");
      try(java.io.OutputStream out=new java.io.FileOutputStream(gameShot)){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}shot.recycle();
      getTargetContext().getSharedPreferences("sei_game",0).edit().putString("board",new String(previous)).commit();
      runOnMainSync(() -> activity.finish()); waitForIdleSync();
      activity = startActivitySync(new Intent(getTargetContext(), VoiceActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      Field callActive=VoiceActivity.class.getDeclaredField("active");callActive.setAccessible(true);
      check(!callActive.getBoolean(activity),"voice screen never opens the microphone automatically");
      Field ttsReady=VoiceActivity.class.getDeclaredField("ready");ttsReady.setAccessible(true);
      long deadline=System.currentTimeMillis()+20000;
      while(!ttsReady.getBoolean(activity)&&System.currentTimeMillis()<deadline)Thread.sleep(200);
      check(ttsReady.getBoolean(activity),"Google Italian TTS initializes on the phone");
      Field ttsField=VoiceActivity.class.getDeclaredField("tts");ttsField.setAccessible(true);
      android.speech.tts.TextToSpeech engine=(android.speech.tts.TextToSpeech)ttsField.get(activity);
      java.util.concurrent.CountDownLatch audioReady=new java.util.concurrent.CountDownLatch(1);
      java.io.File audio=new java.io.File(getTargetContext().getExternalFilesDir(null),"voice-test.wav");
      runOnMainSync(()->{
        engine.setOnUtteranceProgressListener(new android.speech.tts.UtteranceProgressListener(){public void onStart(String id){}public void onDone(String id){audioReady.countDown();}public void onError(String id){audioReady.countDown();}});
        engine.synthesizeToFile("Ciao, sono Solphivia. Possiamo parlare e giocare insieme.",null,audio,"synthetic-voice-test");
      });
      check(audioReady.await(25,java.util.concurrent.TimeUnit.SECONDS)&&audio.length()>44,"Google TTS produces a nonempty Italian audio file");
      result.putString("stream", "OK: " + passed + " device regressions passed\n");
    } catch (Throwable error) {
      result.putString(
          "stream", "FAIL: " + error.getClass().getSimpleName() + ": " + error.getMessage() + "\n");
      result.putString("failure", error.toString());
    } finally {
      if (activity != null) runOnMainSync(() -> activity.finish());
      android.content.SharedPreferences.Editor edit = prefs.edit().clear();
      for (Map.Entry<String, ?> e : original.entrySet()) {
        Object v = e.getValue();
        if (v instanceof String) edit.putString(e.getKey(), (String) v);
        else if (v instanceof Boolean) edit.putBoolean(e.getKey(), (Boolean) v);
        else if (v instanceof Integer) edit.putInt(e.getKey(), (Integer) v);
        else if (v instanceof Long) edit.putLong(e.getKey(), (Long) v);
        else if (v instanceof Float) edit.putFloat(e.getKey(), (Float) v);
      }
      edit.commit();
      getTargetContext()
          .getSharedPreferences("chatgpt_oauth", 0)
          .edit()
          .remove("enc_test_probe")
          .commit();
    }
    finish(result.containsKey("failure") ? Activity.RESULT_CANCELED : Activity.RESULT_OK, result);
  }

  private boolean unbeatable(char[] board) {
    char result = TicTacToe.result(board);
    if (result != ' ') return result != 'X';
    for (int i = 0; i < 9; i++) if (board[i] == ' ') {
      board[i] = 'X';
      if (TicTacToe.result(board) == 'X') { board[i] = ' '; return false; }
      int move = TicTacToe.bestMove(board);
      if (move >= 0) board[move] = 'O';
      boolean okay = unbeatable(board);
      if (move >= 0) board[move] = ' ';
      board[i] = ' ';
      if (!okay) return false;
    }
    return true;
  }
}
