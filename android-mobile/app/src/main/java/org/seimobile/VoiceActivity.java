package org.seimobile;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.speech.*;
import android.speech.tts.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Foreground turn-based voice conversation: recognize, respond, speak, listen again. */
public final class VoiceActivity extends CompanionActivity implements RecognitionListener {
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());
  private SpeechRecognizer recognizer;
  private TextToSpeech tts;
  private TextView state, transcript;
  private Button start, mute;
  private boolean active, muted, listening, busy, ready, foreground;
  private int generation;
  private String baseline = "";

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    layout(
        "Voce con " + companionName(), "Conversazione vocale a turni · resta in questa schermata");
    addAvatar(230);
    state = text("Pronto per parlare", 22, INK);
    state.setGravity(Gravity.CENTER);
    page.addView(state);
    space(8);
    ScrollView scroll = new ScrollView(this);
    transcript =
        text(
            "Avvia la conversazione, parla e aspetta la risposta. Il microfono resta spento finché"
                + " non premi Avvia.",
            17,
            MUTED);
    scroll.addView(transcript);
    page.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
    start = button("Avvia conversazione", true);
    start.setOnClickListener(
        v -> {
          if (active) listen();
          else startCall();
        });
    page.addView(start, new LinearLayout.LayoutParams(-1, dp(54)));
    LinearLayout row = new LinearLayout(this);
    mute = button("Silenzia microfono", false);
    mute.setOnClickListener(
        v -> {
          muted = !muted;
          mute.setText(muted ? "Riattiva microfono" : "Silenzia microfono");
          if (muted) {
            stopListening();
            state.setText("Microfono silenziato");
            avatar.setAnimation("idle");
          } else if (active && !busy && !tts.isSpeaking()) listen();
        });
    row.addView(mute, new LinearLayout.LayoutParams(0, dp(54), 1));
    Button end = button("Termina", false);
    end.setOnClickListener(
        v -> {
          endCall();
          finish();
        });
    row.addView(end, new LinearLayout.LayoutParams(0, dp(54), 1));
    page.addView(row);
    space(8);
    page.addView(
        text(
            "La trascrizione può essere elaborata dal servizio vocale Android/Google; il testo"
                + " viene inviato a ChatGPT. L’audio non viene salvato da Sei Mobile. Uscire"
                + " interrompe il microfono.",
            12,
            MUTED));
    try (InputStream in = getAssets().open("baseline.txt")) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] b = new byte[4096];
      int n;
      while ((n = in.read(b)) != -1) out.write(b, 0, n);
      baseline = new String(out.toByteArray(), StandardCharsets.UTF_8);
    } catch (Exception ignored) {
    }
    if (SpeechRecognizer.isRecognitionAvailable(this)) {
      recognizer = SpeechRecognizer.createSpeechRecognizer(this);
      recognizer.setRecognitionListener(this);
    }
    tts =
        new TextToSpeech(
            this,
            result -> {
              ready = result == TextToSpeech.SUCCESS;
              if (ready) {
                int lang = tts.setLanguage(Locale.ITALIAN);
                ready =
                    lang != TextToSpeech.LANG_MISSING_DATA
                        && lang != TextToSpeech.LANG_NOT_SUPPORTED;
                tts.setSpeechRate(.96f);
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                  Voice best = null;
                  for (Voice voice : voices)
                    if (voice.getLocale().getLanguage().equals("it")
                        && (best == null || voice.getQuality() > best.getQuality())) best = voice;
                  if (best != null) tts.setVoice(best);
                }
              }
              if (!ready) state.setText("Voce italiana non disponibile: controlla il motore TTS.");
            },
            "com.google.android.tts");
    tts.setOnUtteranceProgressListener(
        new UtteranceProgressListener() {
          public void onStart(String id) {
            main.post(
                () -> {
                  if (active) avatar.setAnimation("talk");
                });
          }

          public void onDone(String id) {
            main.post(
                () -> {
                  avatar.setAnimation("idle");
                  if (active && !muted && foreground) main.postDelayed(() -> listen(), 500);
                });
          }

          public void onError(String id) {
            main.post(
                () -> {
                  state.setText("Lettura non riuscita. Tocca Parla per continuare.");
                  avatar.setAnimation("idle");
                });
          }
        });
  }

  private void startCall() {
    if (!ChatGptClient.isConnected(this)) {
      new android.app.AlertDialog.Builder(this)
          .setTitle("Collega ChatGPT")
          .setMessage("Collega prima ChatGPT dalla schermata Chat, poi torna qui per parlare.")
          .setPositiveButton("Torna alla chat", (d, w) -> finish())
          .show();
      return;
    }
    if (recognizer == null) {
      state.setText("Riconoscimento vocale non disponibile sul dispositivo.");
      return;
    }
    if (!ready) {
      state.setText("Attendi la voce italiana, oppure controlla il motore Google TTS.");
      return;
    }
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, 71);
      return;
    }
    active = true;
    start.setText("Parla / riprova");
    listen();
  }

  private void listen() {
    if (!active || muted || busy || listening || !foreground) return;
    if (tts != null && tts.isSpeaking()) tts.stop();
    Intent intent =
        new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "it-IT")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
    listening = true;
    state.setText("Ti ascolto…");
    avatar.setAnimation("listen");
    try {
      recognizer.startListening(intent);
    } catch (Exception e) {
      listening = false;
      state.setText("Microfono non disponibile. Tocca Parla per riprovare.");
    }
  }

  private void stopListening() {
    listening = false;
    if (recognizer != null) recognizer.cancel();
  }

  private void endCall() {
    active = false;
    generation++;
    busy = false;
    main.removeCallbacksAndMessages(null);
    stopListening();
    if (tts != null) tts.stop();
    ChatGptClient.cancelReply();
    if (avatar != null) avatar.setAnimation("idle");
  }

  private void respond(String value) {
    if (!active || busy || value.trim().isEmpty()) return;
    busy = true;
    int id = ++generation;
    state.setText("Sta pensando…");
    avatar.setAnimation("look");
    transcript.setText("Tu: " + value);
    android.content.SharedPreferences prefs = getSharedPreferences("sei_mobile", 0);
    JSONArray history;
    try {
      history = new JSONArray(prefs.getString("messages", "[]"));
    } catch (Exception e) {
      history = new JSONArray();
    }
    final JSONArray saved = history;
    JSONArray request = new JSONArray();
    try {
      for (int i = Math.max(0, history.length() - 30); i < history.length(); i++)
        request.put(history.getJSONObject(i));
      request.put(new JSONObject().put("role", "user").put("content", value));
    } catch (Exception e) {
      busy = false;
      return;
    }
    ChatGptClient.respond(
        this,
        worker,
        baseline
            + "\nCharacter name: "
            + companionName()
            + "\nPersonality: "
            + prefs.getString("persona", "Curiosa, gentile e spontanea")
            + "\n"
            + "This is a spoken conversation: use short, natural replies in Italian, with no"
            + " markdown or stage directions.",
        request,
        new ChatGptClient.ReplyListener() {
          public void onDelta(String update) {
            if (id == generation && active)
              transcript.setText("Tu: " + value + "\n\n" + companionName() + ": " + update);
          }

          public void onDone(String reply) {
            if (id != generation || !active) return;
            busy = false;
            try {
              saved.put(new JSONObject().put("role", "user").put("content", value));
              saved.put(new JSONObject().put("role", "assistant").put("content", reply));
              prefs.edit().putString("messages", saved.toString()).apply();
            } catch (Exception ignored) {
            }
            state.setText("Ti rispondo…");
            int result = tts.speak(reply, TextToSpeech.QUEUE_FLUSH, null, "sei-reply-" + id);
            if (result == TextToSpeech.ERROR)
              state.setText("Lettura non riuscita. Tocca Parla per continuare.");
          }

          public void onError(String error) {
            if (id != generation || !active) return;
            busy = false;
            avatar.setAnimation("idle");
            state.setText(error + " Tocca Parla per riprovare.");
          }
        });
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
    super.onRequestPermissionsResult(code, permissions, grants);
    if (code == 71) {
      if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) startCall();
      else state.setText("Microfono non autorizzato. Puoi continuare nella chat scritta.");
    }
  }

  @Override
  protected void onResume() {
    super.onResume();
    foreground = true;
  }

  @Override
  protected void onPause() {
    foreground = false;
    endCall();
    if (state != null) state.setText("Conversazione in pausa. Premi Avvia per riprendere.");
    if (start != null) start.setText("Avvia conversazione");
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    endCall();
    if (recognizer != null) recognizer.destroy();
    if (tts != null) tts.shutdown();
    worker.shutdownNow();
    super.onDestroy();
  }

  @Override
  public void onReadyForSpeech(Bundle b) {}

  @Override
  public void onBeginningOfSpeech() {}

  @Override
  public void onRmsChanged(float rms) {}

  @Override
  public void onBufferReceived(byte[] b) {}

  @Override
  public void onEndOfSpeech() {
    listening = false;
    state.setText("Elaboro la voce…");
  }

  @Override
  public void onError(int error) {
    listening = false;
    if (!active || muted) return;
    avatar.setAnimation("idle");
    state.setText(
        error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
            ? "Non ho sentito una frase. Tocca Parla per riprovare."
            : "Riconoscimento non riuscito (" + error + "). Tocca Parla per riprovare.");
  }

  @Override
  public void onResults(Bundle results) {
    listening = false;
    if (!active || muted) return;
    ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
    if (list != null && !list.isEmpty()) respond(list.get(0));
  }

  @Override
  public void onPartialResults(Bundle results) {
    ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
    if (active && listening && list != null && !list.isEmpty())
      transcript.setText("Tu: " + list.get(0));
  }

  @Override
  public void onEvent(int event, Bundle b) {}
}
