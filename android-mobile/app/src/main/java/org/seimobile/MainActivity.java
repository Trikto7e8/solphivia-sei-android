package org.seimobile;

import android.app.*;
import android.content.*;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.json.*;

/** Native Android conversation surface, independent from Electron. */
public final class MainActivity extends Activity {
  private static final int BG = 0xff101725,
      PANEL = 0xff1a2538,
      INK = 0xffeef4ff,
      MUTED = 0xffa4b4cd,
      BLUE = 0xff9cc5ff;
  private android.content.SharedPreferences prefs;
  private JSONArray messages = new JSONArray();
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private LinearLayout root, conversation;
  private ScrollView scroll;
  private EditText input;
  private TextView status, live;
  private Button send, connect;
  private PetView avatar;
  private boolean busy, settings;
  private int requestId;
  private String baseline = "", draft = "", pendingText = "";

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setStatusBarColor(BG);
    getWindow().setNavigationBarColor(BG);
    prefs = getSharedPreferences("sei_mobile", MODE_PRIVATE);
    if (!prefs.contains("name")) prefs.edit().putString("name", "Solphivia").apply();
    try (InputStream in = getAssets().open("baseline.txt")) {
      ByteArrayOutputStream b = new ByteArrayOutputStream();
      byte[] buf = new byte[4096];
      int n;
      while ((n = in.read(buf)) != -1) b.write(buf, 0, n);
      baseline = new String(b.toByteArray(), StandardCharsets.UTF_8);
    } catch (Exception ignored) {
    }
    try {
      messages = new JSONArray(prefs.getString("messages", "[]"));
    } catch (Exception ignored) {
    }
    draft = prefs.getString("draft", "");
    showChat();
  }

  private int dp(float n) {
    return (int) (n * getResources().getDisplayMetrics().density + .5f);
  }

  private GradientDrawable shape(int color) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(color);
    d.setCornerRadius(dp(16));
    return d;
  }

  private TextView text(String s, int size, int color) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextSize(size);
    t.setTextColor(color);
    return t;
  }

  private TextView label(String s) {
    TextView t = text(s, 11, MUTED);
    t.setTypeface(Typeface.MONOSPACE);
    t.setLetterSpacing(.1f);
    return t;
  }

  private LinearLayout column() {
    LinearLayout l = new LinearLayout(this);
    l.setOrientation(LinearLayout.VERTICAL);
    return l;
  }

  private Button button(String s, boolean primary) {
    Button b = new Button(this);
    b.setText(s);
    b.setAllCaps(false);
    b.setTextSize(14);
    b.setTextColor(primary ? BG : INK);
    b.setBackgroundTintList(ColorStateList.valueOf(primary ? BLUE : 0xff30415c));
    b.setMinHeight(dp(48));
    return b;
  }

  private EditText field(String hint, String value, boolean multi) {
    EditText e = new EditText(this);
    e.setTextColor(INK);
    e.setHintTextColor(MUTED);
    e.setTextSize(16);
    e.setHint(hint);
    e.setText(value);
    e.setSingleLine(!multi);
    e.setPadding(dp(14), dp(12), dp(14), dp(12));
    e.setBackground(shape(PANEL));
    return e;
  }

  private void space(LinearLayout l, int h) {
    l.addView(new View(this), new LinearLayout.LayoutParams(1, dp(h)));
  }

  private void rememberDraft() {
    if (input != null && !settings && !busy) draft = input.getText().toString();
    prefs.edit().putString("draft", busy ? pendingText : draft).apply();
  }

  private void showChat() {
    settings = false;
    input = null;
    root = column();
    root.setBackgroundColor(BG);
    insets(root, 20, 14, 20, 12);
    LinearLayout header = new LinearLayout(this);
    header.setGravity(Gravity.CENTER_VERTICAL);
    LinearLayout brand = column();
    TextView title = text("SEI / MOBILE", 24, INK);
    title.setTypeface(null, Typeface.BOLD);
    brand.addView(title);
    brand.addView(label("COMMUNITY ANDROID PREVIEW"));
    header.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
    Button gear = button("Companion", false);
    gear.setId(R.id.configure_companion);
    gear.setOnClickListener(
        v -> {
          rememberDraft();
          showSettings();
        });
    header.addView(gear);
    root.addView(header);
    space(root, 16);
    LinearLayout profile = new LinearLayout(this);
    profile.setPadding(dp(18), dp(14), dp(18), dp(14));
    profile.setBackground(shape(PANEL));
    avatar = new PetView(this);
    avatar.setContentDescription("Solphivia animata, il tuo companion");
    avatar.setAnimation(busy ? "look" : "idle");
    profile.addView(avatar, new LinearLayout.LayoutParams(dp(88), dp(112)));
    LinearLayout identity = column();
    identity.setGravity(Gravity.CENTER_VERTICAL);
    identity.addView(text(prefs.getString("name", "Solphivia"), 23, BLUE));
    identity.addView(text("Chat, voce e piccole sfide insieme.", 13, MUTED));
    profile.addView(identity, new LinearLayout.LayoutParams(0, -1, 1));
    root.addView(profile);
    space(root, 10);
    connect =
        button(
            ChatGptClient.isConnected(this) ? "ChatGPT collegato" : "Continua con ChatGPT",
            !ChatGptClient.isConnected(this));
    connect.setId(R.id.connect_chatgpt);
    connect.setOnClickListener(
        v -> {
          if (ChatGptClient.isConnected(this)) {
            rememberDraft();
            showSettings();
          } else authorize();
        });
    connect.setEnabled(!busy && !ChatGptClient.isAuthorizing());
    root.addView(connect, new LinearLayout.LayoutParams(-1, dp(50)));
    status =
        text(
            busy
                ? "Sta scrivendo…"
                : ChatGptClient.isAuthorizing()
                    ? "Completa l’accesso nel browser, poi torna qui."
                    : ChatGptClient.isConnected(this)
                        ? "Collegato · conversazione salvata sul telefono"
                        : "Collega il tuo account per iniziare.",
            12,
            MUTED);
    root.addView(status);
    LinearLayout experiences = new LinearLayout(this);
    Button game = button("Gioca a tris", false);
    game.setOnClickListener(
        v -> {
          if (busy) return;
          rememberDraft();
          startActivity(new Intent(this, GameActivity.class));
        });
    experiences.addView(game, new LinearLayout.LayoutParams(0, dp(50), 1));
    Button voice = button("Parla / call", false);
    voice.setOnClickListener(
        v -> {
          if (busy) return;
          rememberDraft();
          startActivity(new Intent(this, VoiceActivity.class));
        });
    experiences.addView(voice, new LinearLayout.LayoutParams(0, dp(50), 1));
    root.addView(experiences);
    scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    conversation = column();
    conversation.setPadding(0, dp(14), 0, dp(12));
    scroll.addView(conversation);
    root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
    LinearLayout composer = new LinearLayout(this);
    composer.setGravity(Gravity.BOTTOM);
    input = field("Scrivi al tuo companion…", draft, true);
    input.setMaxLines(5);
    input.setId(R.id.message_input);
    composer.addView(input, new LinearLayout.LayoutParams(0, -2, 1));
    send = button(busy ? "Stop" : "Invia", true);
    send.setId(R.id.send_message);
    send.setOnClickListener(
        v -> {
          if (busy) cancelGeneration();
          else sendMessage();
        });
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(78), dp(52));
    p.setMargins(dp(8), 0, 0, 0);
    composer.addView(send, p);
    root.addView(composer);
    setContentView(root);
    render();
  }

  private void render() {
    conversation.removeAllViews();
    live = null;
    if (messages.length() == 0 && !busy) {
      LinearLayout welcome = column();
      welcome.setPadding(dp(8), dp(28), dp(8), dp(12));
      welcome.addView(label("IL TUO SPAZIO, IN TASCA"));
      space(welcome, 12);
      TextView h = text("Cominciamo da te.", 28, INK);
      h.setTypeface(null, Typeface.BOLD);
      welcome.addView(h);
      space(welcome, 12);
      welcome.addView(
          text(
              "Scegli un nome e un carattere. Poi raccontagli una cosa, fai una domanda o costruite"
                  + " un’idea insieme.",
              16,
              MUTED));
      space(welcome, 22);
      for (String prompt :
          new String[] {"Ciao! Conosciamoci un po’.", "Ti va di inventare qualcosa insieme?"}) {
        Button chip = button(prompt, false);
        chip.setOnClickListener(
            v -> {
              input.setText(prompt);
              input.setSelection(prompt.length());
            });
        welcome.addView(chip, new LinearLayout.LayoutParams(-1, dp(54)));
        space(welcome, 6);
      }
      conversation.addView(welcome);
    }
    for (int i = 0; i < messages.length(); i++) {
      JSONObject m = messages.optJSONObject(i);
      if (m != null) bubble(m.optString("role"), m.optString("content"));
    }
    if (busy) {
      bubble("user", pendingText);
      live = bubble("assistant", "Sta scrivendo…");
    }
    scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
  }

  private TextView bubble(String role, String value) {
    LinearLayout box = column();
    box.setPadding(dp(15), dp(13), dp(15), dp(13));
    box.setBackground(shape(role.equals("user") ? 0xff263d5b : PANEL));
    box.addView(
        label(
            role.equals("user")
                ? "TU"
                : prefs.getString("name", "Companion").toUpperCase(java.util.Locale.ROOT)));
    TextView body = text(value, 17, INK);
    body.setTextIsSelectable(true);
    body.setLineSpacing(dp(3), 1);
    box.addView(body);
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.setMargins(role.equals("user") ? dp(26) : 0, 0, role.equals("user") ? 0 : dp(20), dp(12));
    conversation.addView(box, p);
    return body;
  }

  private void authorize() {
    rememberDraft();
    if (busy || ChatGptClient.isAuthorizing()) return;
    connect.setEnabled(false);
    status.setText(R.string.auth_browser_prompt);
    ChatGptClient.authorize(
        this,
        worker,
        new ChatGptClient.AuthCallback() {
          public void onSuccess(String account) {
            if (!isDestroyed()) {
              showChat();
              status.setText(R.string.auth_success);
            }
          }

          public void onError(String error) {
            if (!isDestroyed()) {
              showChat();
              new AlertDialog.Builder(MainActivity.this)
                  .setTitle("Collegamento ChatGPT")
                  .setMessage(error)
                  .setPositiveButton("Va bene", null)
                  .show();
            }
          }
        });
  }

  private void sendMessage() {
    String value = input.getText().toString().trim();
    if (value.isEmpty() || busy) return;
    if (!ChatGptClient.isConnected(this)) {
      rememberDraft();
      authorize();
      return;
    }
    JSONArray request = new JSONArray();
    try {
      for (int i = Math.max(0, messages.length() - 30); i < messages.length(); i++)
        request.put(messages.getJSONObject(i));
      request.put(new JSONObject().put("role", "user").put("content", value));
    } catch (Exception e) {
      return;
    }
    busy = true;
    pendingText = value;
    draft = "";
    int id = ++requestId;
    prefs.edit().putString("draft", value).apply();
    showChat();
    String instructions =
        baseline
            + "\n\nCharacter name: "
            + prefs.getString("name", "Companion")
            + "\nPersonality: "
            + prefs.getString("persona", "Curioso, gentile e spontaneo");
    ChatGptClient.respond(
        this,
        worker,
        instructions,
        request,
        new ChatGptClient.ReplyListener() {
          public void onDelta(String update) {
            if (id == requestId && !isDestroyed()) {
              live.setText(update);
              scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
            }
          }

          public void onDone(String reply) {
            if (id != requestId || isDestroyed()) return;
            try {
              messages.put(new JSONObject().put("role", "user").put("content", value));
              messages.put(new JSONObject().put("role", "assistant").put("content", reply));
            } catch (Exception ignored) {
            }
            busy = false;
            pendingText = "";
            persist();
            showChat();
          }

          public void onError(String error) {
            if (id != requestId || isDestroyed()) return;
            busy = false;
            draft = value;
            pendingText = "";
            persist();
            showChat();
            status.setText(error);
          }
        });
  }

  private void cancelGeneration() {
    requestId++;
    ChatGptClient.cancelReply();
    busy = false;
    draft = pendingText;
    pendingText = "";
    persist();
    showChat();
    status.setText(R.string.generation_cancelled);
  }

  private void persist() {
    prefs.edit().putString("messages", messages.toString()).putString("draft", draft).apply();
  }

  private void insets(View view, int left, int top, int right, int bottom) {
    view.setPadding(dp(left), dp(top), dp(right), dp(bottom));
    view.setOnApplyWindowInsetsListener(
        (v, i) -> {
          v.setPadding(
              dp(left) + i.getSystemWindowInsetLeft(),
              dp(top) + i.getSystemWindowInsetTop(),
              dp(right) + i.getSystemWindowInsetRight(),
              dp(bottom) + i.getSystemWindowInsetBottom());
          return i.consumeSystemWindowInsets();
        });
  }

  private void showSettings() {
    if (busy) return;
    settings = true;
    input = null;
    LinearLayout page = column();
    page.setPadding(dp(22), dp(18), dp(22), dp(24));
    page.setBackgroundColor(BG);
    page.addView(label("SEI / IL TUO COMPANION"));
    TextView h = text("Dagli un carattere.", 28, INK);
    h.setTypeface(null, Typeface.BOLD);
    page.addView(h);
    space(page, 20);
    page.addView(text("Nome", 14, MUTED));
    EditText name = field("Nome del companion", prefs.getString("name", "Companion"), false);
    name.setId(R.id.companion_name);
    page.addView(name);
    space(page, 18);
    page.addView(text("Personalità", 14, MUTED));
    EditText persona =
        field(
            "Come parla, cosa ama…",
            prefs.getString(
                "persona",
                "Curioso, gentile e spontaneo. Ama esplorare idee insieme e ascolta senza"
                    + " invadere."),
            true);
    persona.setMinLines(4);
    persona.setId(R.id.companion_persona);
    page.addView(persona);
    space(page, 12);
    LinearLayout presets = new LinearLayout(this);
    for (String p : new String[] {"Curioso", "Creativo", "Calmo"}) {
      Button preset = button(p, false);
      preset.setOnClickListener(
          v ->
              persona.setText(
                  p.equals("Creativo")
                      ? "Creativo, giocoso e pieno di idee. Propone piccoli esperimenti da fare"
                          + " insieme e risponde in modo naturale."
                      : p.equals("Calmo")
                          ? "Calmo, attento e ironico con delicatezza. Ascolta senza giudicare e"
                              + " lascia spazio alla conversazione."
                          : "Curioso, gentile e spontaneo. Ama esplorare idee insieme e ascolta"
                              + " senza invadere."));
      presets.addView(preset, new LinearLayout.LayoutParams(0, dp(52), 1));
    }
    page.addView(presets);
    space(page, 12);
    Button save = button("Salva companion", true);
    save.setId(R.id.save_companion);
    save.setOnClickListener(
        v -> {
          String n = name.getText().toString().trim(), p = persona.getText().toString().trim();
          if (n.isEmpty() || p.isEmpty()) {
            Toast.makeText(this, "Scrivi nome e personalità.", Toast.LENGTH_SHORT).show();
            return;
          }
          prefs.edit().putString("name", n).putString("persona", p).apply();
          showChat();
        });
    page.addView(save, new LinearLayout.LayoutParams(-1, dp(54)));
    space(page, 24);
    page.addView(label("ACCOUNT E CONVERSAZIONE"));
    space(page, 10);
    page.addView(
        text(
            ChatGptClient.isConnected(this)
                ? "ChatGPT collegato · " + ChatGptClient.account(this)
                : "ChatGPT da collegare",
            15,
            BLUE));
    Button link =
        button(
            ChatGptClient.isAuthorizing()
                ? "Annulla collegamento"
                : ChatGptClient.isConnected(this)
                    ? "Scollega questo dispositivo"
                    : "Continua con ChatGPT",
            false);
    link.setOnClickListener(
        v -> {
          if (ChatGptClient.isAuthorizing()) {
            ChatGptClient.cancelAuthorization(this);
            showChat();
          } else if (ChatGptClient.isConnected(this)) {
            new AlertDialog.Builder(this)
                .setTitle("Scollegare ChatGPT?")
                .setMessage(
                    "Le credenziali saranno rimosse da questa app. Puoi revocare l’autorizzazione"
                        + " nelle impostazioni di ChatGPT.")
                .setNegativeButton("Annulla", null)
                .setPositiveButton(
                    "Scollega",
                    (d, w) -> {
                      ChatGptClient.disconnect(this);
                      showChat();
                    })
                .show();
          } else authorize();
        });
    page.addView(link, new LinearLayout.LayoutParams(-1, dp(52)));
    Button export = button("Esporta conversazione (.json)", false);
    export.setOnClickListener(
        v ->
            startActivityForResult(
                new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .setType("application/json")
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .putExtra(Intent.EXTRA_TITLE, "sei-mobile-chat.json"),
                40));
    page.addView(export, new LinearLayout.LayoutParams(-1, dp(52)));
    Button clear = button("Cancella conversazione", false);
    clear.setOnClickListener(
        v ->
            new AlertDialog.Builder(this)
                .setTitle("Cancellare la conversazione?")
                .setMessage("I messaggi salvati in Sei Mobile saranno eliminati.")
                .setNegativeButton("Annulla", null)
                .setPositiveButton(
                    "Cancella",
                    (d, w) -> {
                      messages = new JSONArray();
                      draft = "";
                      persist();
                      showChat();
                    })
                .show());
    page.addView(clear, new LinearLayout.LayoutParams(-1, dp(52)));
    space(page, 18);
    page.addView(
        text(
            "I messaggi restano sul telefono e vengono inviati a OpenAI quando premi Invia. Il"
                + " collegamento usa il piano ChatGPT autorizzato. Questa chat è separata dalle"
                + " conversazioni dell’app ChatGPT.",
            13,
            MUTED));
    space(page, 16);
    page.addView(
        text(
            "Preview community 0.3.0 · basata su SEI e Solphivia Mobile\n"
                + "Chat, avatar, tris e voce a turni. Personaggi cloud SEI, giochi desktop,"
                + " chiamate realtime e sincronizzazione sono ancora da portare.",
            12,
            MUTED));
    space(page, 16);
    Button back = button("Torna alla chat", false);
    back.setOnClickListener(v -> showChat());
    page.addView(back, new LinearLayout.LayoutParams(-1, dp(52)));
    ScrollView s = new ScrollView(this);
    s.setBackgroundColor(BG);
    insets(s, 0, 0, 0, 0);
    s.addView(page);
    setContentView(s);
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == 40 && result == RESULT_OK && data != null) {
      try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
        JSONObject doc =
            new JSONObject()
                .put("format", "sei-mobile-chat-v1")
                .put("name", prefs.getString("name", "Companion"))
                .put("persona", prefs.getString("persona", ""))
                .put("messages", messages);
        out.write(doc.toString(2).getBytes(StandardCharsets.UTF_8));
        Toast.makeText(this, "Conversazione esportata.", Toast.LENGTH_LONG).show();
      } catch (Exception e) {
        Toast.makeText(this, "Esportazione non riuscita.", Toast.LENGTH_LONG).show();
      }
    }
  }

  @Override
  protected void onPause() {
    rememberDraft();
    if (avatar != null) avatar.pause();
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (prefs != null && !busy && !settings) {
      String saved = prefs.getString("messages", "[]");
      if (!saved.equals(messages.toString())) {
        rememberDraft();
        try {
          messages = new JSONArray(saved);
        } catch (Exception ignored) {
        }
        showChat();
      }
    }
    if (avatar != null) avatar.setAnimation(busy ? "look" : "idle");
    if (connect != null) {
      connect.setEnabled(!busy && !ChatGptClient.isAuthorizing());
      if (ChatGptClient.isAuthorizing()) status.setText(R.string.auth_pending);
    }
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    String prompt = intent.getStringExtra("draft_prompt");
    if (prompt != null) {
      draft = prompt;
      prefs.edit().putString("draft", draft).apply();
      showChat();
    }
  }

  @Override
  public void onBackPressed() {
    if (settings) {
      showChat();
      return;
    }
    if (busy) {
      cancelGeneration();
      return;
    }
    super.onBackPressed();
  }

  @Override
  protected void onDestroy() {
    requestId++;
    ChatGptClient.cancelReply();
    ChatGptClient.cancelAuthorization(this);
    worker.shutdownNow();
    super.onDestroy();
  }
}
