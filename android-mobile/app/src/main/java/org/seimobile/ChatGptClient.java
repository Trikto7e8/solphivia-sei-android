package org.seimobile;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.lang.ref.WeakReference;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * OpenAI Sign in with ChatGPT and Responses API transport. Tokens stay in app-private encrypted
 * storage.
 */
final class ChatGptClient {
  interface ReplyListener {
    void onDelta(String text);

    void onDone(String text);

    void onError(String error);
  }

  private static volatile HttpURLConnection pendingConnection;
  private static final java.util.concurrent.atomic.AtomicInteger REQUEST_EPOCH = new java.util.concurrent.atomic.AtomicInteger();

  static void cancelReply() {
    REQUEST_EPOCH.incrementAndGet();
    HttpURLConnection c = pendingConnection;
    if (c != null) c.disconnect();
  }

  static String account(Context c) {
    return c.getSharedPreferences(PREFS, 0).getString("email", "ChatGPT");
  }

  static void disconnect(Context c) {
    cancelReply();
    c.getSharedPreferences(PREFS, 0).edit().clear().apply();
    try {
      KeyStore store = KeyStore.getInstance("AndroidKeyStore");
      store.load(null);
      store.deleteEntry(KEY_ALIAS);
    } catch (Exception ignored) {
    }
  }

  static void respond(
      Context context,
      ExecutorService worker,
      String instructions,
      JSONArray history,
      ReplyListener listener) {
    final String snapshot = history.toString();
    final int epoch = REQUEST_EPOCH.incrementAndGet();
    worker.execute(
        () -> {
          try {
            if (epoch != REQUEST_EPOCH.get()) return;
            if (!isConnected(context)) throw new AuthenticationRequired();
            refreshIfNeeded(context);
            String access = secret(context, "access_token");
            String model = context.getSharedPreferences(PREFS, 0).getString("model", "");
            if (model.isEmpty()) {
              model = chooseModel(context, access);
              context.getSharedPreferences(PREFS, 0).edit().putString("model", model).apply();
            }
            if (epoch != REQUEST_EPOCH.get()) return;
            JSONArray input = new JSONArray(snapshot);
            JSONObject body =
                new JSONObject()
                    .put("model", model)
                    .put("instructions", instructions)
                    .put("input", input)
                    .put("store", false)
                    .put("stream", true);
            HttpURLConnection conn =
                (HttpURLConnection) new URL("https://api.openai.com/v1/responses").openConnection();
            pendingConnection = conn;
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(25000);
            conn.setReadTimeout(120000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Authorization", "Bearer " + access);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try {
              try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
              }
              int status = conn.getResponseCode();
              if (status < 200 || status >= 300) {
                if (status == 401) {
                  requireAuthentication(context);
                  throw new AuthenticationRequired();
                }
                throw httpError(conn, status);
              }
              StringBuilder text = new StringBuilder();
              boolean completed = false;
              try (BufferedReader reader =
                  new BufferedReader(
                      new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                  if (epoch != REQUEST_EPOCH.get()) return;
                  if (!line.startsWith("data:")) continue;
                  String data = line.substring(5).trim();
                  if (data.isEmpty() || "[DONE]".equals(data)) continue;
                  JSONObject event = new JSONObject(data);
                  String type = event.optString("type");
                  if (type.equals("response.output_text.delta")) {
                    text.append(event.optString("delta"));
                    String update = text.toString();
                    MAIN.post(() -> { if (epoch == REQUEST_EPOCH.get()) listener.onDelta(update); });
                  } else if (type.equals("response.completed")) completed = true;
                  else if (type.equals("response.failed")
                      || type.equals("response.incomplete")
                      || type.equals("error")) {
                    JSONObject response = event.optJSONObject("response");
                    JSONObject error =
                        response == null
                            ? event.optJSONObject("error")
                            : response.optJSONObject("error");
                    throw new IllegalStateException(
                        error == null
                            ? "Risposta non completata. Riprova."
                            : error.optString("code", "")
                                + ": "
                                + error.optString("message", "Richiesta non riuscita."));
                  }
                }
              }
              if (!completed)
                throw new IllegalStateException(
                    "Connessione interrotta: la risposta non è completa.");
              String result = text.toString().trim();
              if (result.isEmpty()) throw new IllegalStateException("Risposta vuota. Riprova.");
              MAIN.post(() -> { if (epoch == REQUEST_EPOCH.get()) listener.onDone(result); });
            } finally {
              if (pendingConnection == conn) pendingConnection = null;
              conn.disconnect();
            }
          } catch (Exception error) {
            String message = safeMessage(error);
            MAIN.post(() -> { if (epoch == REQUEST_EPOCH.get()) listener.onError(message); });
          }
        });
  }

  private static final String AUTHORIZE = "https://auth.openai.com/api/accounts/authorize";
  private static final String TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
  private static final String RESOURCE = "https://api.openai.com/v1";
  private static final String ISSUER = "https://auth.openai.com";
  private static final String SCOPES =
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
  private static final String PREFS = "chatgpt_oauth";
  private static final String KEY_ALIAS = "sei-mobile-chatgpt-tokens-v1";
  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  private static volatile boolean authorizationRunning;
  private static volatile WeakReference<Activity> authorizationOwner;
  private static volatile ServerSocket authorizationSocket;

  static void cancelAuthorization(Activity activity) {
    Activity owner = authorizationOwner == null ? null : authorizationOwner.get();
    if (owner != activity) return;
    ServerSocket socket = authorizationSocket;
    if (socket != null)
      try {
        socket.close();
      } catch (Exception ignored) {
      }
  }

  private static boolean alive(Activity activity) {
    return !activity.isFinishing() && !activity.isDestroyed();
  }

  private static final class AuthenticationRequired extends IllegalStateException {
    AuthenticationRequired() {
      super("Accesso scaduto o revocato. Ricollega ChatGPT dall’app.");
    }
  }

  private static void requireAuthentication(Context context) {
    context
        .getSharedPreferences(PREFS, 0)
        .edit()
        .putBoolean("plan_allowed", false)
        .remove("model")
        .apply();
  }

  interface AuthCallback {
    void onSuccess(String account);

    void onError(String message);
  }

  interface ChatCallback {
    void onSuccess(String reply, String animation, String motion, String mode);

    void onError(String message);
  }

  private ChatGptClient() {}

  static boolean isConnected(Context context) {
    return !secret(context, "access_token").isEmpty()
        && context.getSharedPreferences(PREFS, 0).getBoolean("plan_allowed", false);
  }

  static void authorize(Activity activity, ExecutorService worker, AuthCallback callback) {
    synchronized (ChatGptClient.class) {
      if (authorizationRunning) {
        postAuthError(
            callback,
            "Autorizzazione ChatGPT già in corso. Completa quella aperta e torna a Sei Mobile.");
        return;
      }
      authorizationRunning = true;
      authorizationOwner = new WeakReference<>(activity);
    }
    Intent keepAlive = new Intent(activity, OAuthKeepAliveService.class);
    try {
      if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(keepAlive);
      else activity.startService(keepAlive);
      worker.execute(
          () -> {
            String account = null;
            String error = null;
            try {
              account = doAuthorize(activity);
            } catch (Exception e) {
              error = "Accesso ChatGPT non riuscito: " + safeMessage(e);
            }
            final String result = account, failure = error;
            MAIN.post(
                () -> {
                  activity.stopService(keepAlive);
                  synchronized (ChatGptClient.class) {
                    authorizationOwner = null;
                    authorizationSocket = null;
                    authorizationRunning = false;
                  }
                  if (!alive(activity)) return;
                  if (failure == null) callback.onSuccess(result);
                  else callback.onError(failure);
                });
          });
    } catch (Exception e) {
      authorizationOwner = null;
      authorizationRunning = false;
      activity.stopService(keepAlive);
      postAuthError(
          callback, "Non riesco a mantenere attivo il collegamento ChatGPT: " + safeMessage(e));
    }
  }

  static boolean isAuthorizing() {
    return authorizationRunning;
  }

  private static String doAuthorize(Activity activity) throws Exception {
    Context context = activity.getApplicationContext();
    String host = context.getSharedPreferences(PREFS, 0).getString("host_id", null);
    if (host == null) {
      host = "urn:uuid:" + UUID.randomUUID();
      context.getSharedPreferences(PREFS, 0).edit().putString("host_id", host).apply();
    }
    String state = randomUrlSafe(32), nonce = randomUrlSafe(32), verifier = randomUrlSafe(48);
    String challenge =
        Base64.encodeToString(
            MessageDigest.getInstance("SHA-256")
                .digest(verifier.getBytes(StandardCharsets.US_ASCII)),
            Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    ServerSocket server = new ServerSocket();
    server.setReuseAddress(false);
    server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 1);
    // The browser may take several minutes; OAuthKeepAliveService keeps this
    // local loopback listener alive while Android backgrounds the activity.
    server.setSoTimeout(900000);
    authorizationSocket = server;
    if (!alive(activity)) {
      server.close();
      throw new IllegalStateException("Collegamento annullato.");
    }
    String redirect = "http://127.0.0.1:" + server.getLocalPort() + "/auth/callback";
    String savedClient = context.getSharedPreferences(PREFS, 0).getString("client_id", "");
    boolean firstRegistration = savedClient.isEmpty();
    String clientId = firstRegistration ? "dynamic_agent_client" : savedClient;
    Uri.Builder builder =
        Uri.parse(AUTHORIZE)
            .buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("ext_agent_host_id", host)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("redirect_uri", redirect)
            .appendQueryParameter("scope", SCOPES)
            .appendQueryParameter("resource", RESOURCE)
            .appendQueryParameter("state", state)
            .appendQueryParameter("nonce", nonce)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("code_challenge", challenge);
    if (firstRegistration) builder.appendQueryParameter("agent_name_hint", "Sei Mobile");
    else {
      String hint = secret(context, "id_token");
      if (!hint.isEmpty()) builder.appendQueryParameter("id_token_hint", hint);
      String email = context.getSharedPreferences(PREFS, 0).getString("email", "");
      if (!email.isEmpty()) builder.appendQueryParameter("login_hint", email);
    }
    Uri authUri = builder.build();
    MAIN.post(
        () -> {
          if (!alive(activity)) {
            cancelAuthorization(activity);
            return;
          }
          try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, authUri));
          } catch (Exception e) {
            cancelAuthorization(activity);
          }
        });

    Callback callbackData;
    try (Socket socket = server.accept()) {
      callbackData = readCallback(socket);
    } finally {
      try {
        server.close();
      } catch (Exception ignored) {
      }
    }
    if (!state.equals(callbackData.params.get("state")))
      throw new SecurityException("Il controllo di sicurezza OAuth non è riuscito.");
    if (callbackData.params.containsKey("error"))
      throw new IllegalStateException("Autorizzazione annullata o negata da ChatGPT.");
    String code = callbackData.params.get("code");
    String callbackClient = callbackData.params.get("client_id");
    String issuedClient = callbackClient == null ? savedClient : callbackClient;
    if (!firstRegistration && !savedClient.equals(issuedClient))
      throw new SecurityException(
          "ChatGPT ha restituito un account diverso da quello selezionato.");
    if (code == null
        || issuedClient == null
        || issuedClient.isEmpty()
        || issuedClient.equals("dynamic_agent_client"))
      throw new IllegalStateException("ChatGPT non ha completato la registrazione dell’app.");

    JSONObject tokens =
        postForm(
            TOKEN,
            form(
                "grant_type",
                "authorization_code",
                "client_id",
                issuedClient,
                "code",
                code,
                "code_verifier",
                verifier,
                "redirect_uri",
                redirect,
                "resource",
                RESOURCE));
    String idToken = tokens.optString("id_token", "");
    if (idToken.isEmpty())
      throw new SecurityException("ChatGPT non ha restituito l’identità dell’account.");
    JSONObject claims = validateIdToken(idToken, issuedClient, nonce);
    String granted = tokens.optString("scope", callbackData.params.getOrDefault("scope", ""));
    boolean planAllowed =
        containsScope(granted, "chatgpt.tokens.use.direct")
            && containsScope(granted, "resource.invoke");
    if (!planAllowed)
      throw new SecurityException(
          "Il permesso per le richieste IA non è stato concesso. Ricollega ChatGPT e approva l’uso"
              + " del piano.");

    JSONObject profile = claims.optJSONObject("https://api.openai.com/auth");
    String email = claims.optString("email", profile == null ? "" : profile.optString("email", ""));
    long expires =
        System.currentTimeMillis() + Math.max(60, tokens.optLong("expires_in", 3600)) * 1000L;
    android.content.SharedPreferences p = context.getSharedPreferences(PREFS, 0);
    if (!alive(activity)) throw new IllegalStateException("Collegamento annullato.");
    p.edit()
        .putString("client_id", issuedClient)
        .putString("email", email)
        .putString("scope", granted)
        .putLong("expires_at", expires)
        .putBoolean("plan_allowed", true)
        .remove("model")
        .apply();
    putSecret(context, "access_token", tokens.optString("access_token", ""));
    putSecret(context, "refresh_token", tokens.optString("refresh_token", ""));
    putSecret(context, "id_token", idToken);
    return email.isEmpty() ? "ChatGPT" : email;
  }

  private static String chooseModel(Context context, String access) throws Exception {
    HttpURLConnection conn =
        (HttpURLConnection) new URL("https://api.openai.com/v1/models").openConnection();
    conn.setConnectTimeout(20000);
    conn.setReadTimeout(30000);
    conn.setRequestProperty("Authorization", "Bearer " + access);
    int code = conn.getResponseCode();
    if (code < 200 || code >= 300) {
      try {
        if (code == 401) {
          requireAuthentication(context);
          throw new AuthenticationRequired();
        }
        throw httpError(conn, code);
      } finally {
        conn.disconnect();
      }
    }
    try (InputStream in = conn.getInputStream()) {
      JSONObject root = new JSONObject(readAll(in));
      JSONArray list = root.optJSONArray("models");
      if (list != null)
        for (int i = 0; i < list.length(); i++) {
          JSONObject m = list.optJSONObject(i);
          if (m != null
              && "list".equals(m.optString("visibility"))
              && !m.optString("slug").isEmpty()) return m.optString("slug");
        }
    } finally {
      conn.disconnect();
    }
    throw new IllegalStateException("Non trovo un modello ChatGPT disponibile per questo account.");
  }

  private static synchronized void refreshIfNeeded(Context context) throws Exception {
    android.content.SharedPreferences p = context.getSharedPreferences(PREFS, 0);
    if (p.getLong("expires_at", 0) > System.currentTimeMillis() + 90000) return;
    String refresh = secret(context, "refresh_token"), client = p.getString("client_id", "");
    if (refresh.isEmpty() || client.isEmpty()) {
      requireAuthentication(context);
      throw new AuthenticationRequired();
    }
    JSONObject result;
    try {
      result =
          postForm(
              TOKEN,
              form(
                  "grant_type",
                  "refresh_token",
                  "client_id",
                  client,
                  "refresh_token",
                  refresh,
                  "resource",
                  RESOURCE));
    } catch (Exception error) {
      String message = safeMessage(error);
      if (message.contains("invalid_grant")
          || message.contains("invalid_client")
          || message.startsWith("HTTP 401")) {
        requireAuthentication(context);
        throw new AuthenticationRequired();
      }
      throw error;
    }
    String access = result.optString("access_token", "");
    if (access.isEmpty()) throw new IllegalStateException("ChatGPT non ha rinnovato l’accesso.");
    putSecret(context, "access_token", access);
    if (!result.optString("refresh_token", "").isEmpty())
      putSecret(context, "refresh_token", result.optString("refresh_token"));
    if (!result.optString("id_token", "").isEmpty())
      putSecret(context, "id_token", result.optString("id_token"));
    p.edit()
        .putLong(
            "expires_at",
            System.currentTimeMillis() + Math.max(60, result.optLong("expires_in", 3600)) * 1000L)
        .apply();
  }

  private static JSONObject validateIdToken(String jwt, String clientId, String nonce)
      throws Exception {
    String[] parts = jwt.split("\\.");
    if (parts.length != 3) throw new SecurityException("ID token non valido.");
    JSONObject header =
        new JSONObject(
            new String(
                Base64.decode(parts[0], Base64.URL_SAFE | Base64.NO_WRAP), StandardCharsets.UTF_8));
    JSONObject claims =
        new JSONObject(
            new String(
                Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP), StandardCharsets.UTF_8));
    if (!"RS256".equals(header.optString("alg")))
      throw new SecurityException("Firma ID token non supportata.");
    if (!ISSUER.equals(claims.optString("iss")))
      throw new SecurityException("Emittente ID token non valido.");
    Object aud = claims.opt("aud");
    boolean audience = clientId.equals(aud);
    if (aud instanceof JSONArray) {
      JSONArray a = (JSONArray) aud;
      for (int i = 0; i < a.length(); i++) if (clientId.equals(a.optString(i))) audience = true;
    }
    if (!audience
        || claims.optLong("exp", 0) <= System.currentTimeMillis() / 1000L
        || !nonce.equals(claims.optString("nonce")))
      throw new SecurityException("Controlli ID token non riusciti.");
    JSONObject discovery = getJson("https://auth.openai.com/.well-known/openid-configuration");
    String jwksUri = discovery.optString("jwks_uri", "");
    if (jwksUri.isEmpty()) throw new SecurityException("Chiavi di firma non disponibili.");
    JSONObject jwks = getJson(jwksUri);
    JSONArray keys = jwks.optJSONArray("keys");
    String kid = header.optString("kid");
    JSONObject selected = null;
    if (keys != null)
      for (int i = 0; i < keys.length(); i++) {
        JSONObject k = keys.optJSONObject(i);
        if (k != null && kid.equals(k.optString("kid")) && "RSA".equals(k.optString("kty"))) {
          selected = k;
          break;
        }
      }
    if (selected == null) throw new SecurityException("Chiave firma ID token non trovata.");
    BigInteger modulus =
        new BigInteger(1, Base64.decode(selected.getString("n"), Base64.URL_SAFE | Base64.NO_WRAP));
    BigInteger exponent =
        new BigInteger(1, Base64.decode(selected.getString("e"), Base64.URL_SAFE | Base64.NO_WRAP));
    java.security.PublicKey key =
        KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(modulus, exponent));
    Signature verifier = Signature.getInstance("SHA256withRSA");
    verifier.initVerify(key);
    verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
    if (!verifier.verify(Base64.decode(parts[2], Base64.URL_SAFE | Base64.NO_WRAP)))
      throw new SecurityException("Firma ID token non valida.");
    return claims;
  }

  private static Callback readCallback(Socket socket) throws Exception {
    socket.setSoTimeout(15000);
    BufferedReader in =
        new BufferedReader(
            new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
    String request = in.readLine();
    if (request == null) throw new IllegalStateException("Callback OAuth vuota.");
    String[] bits = request.split(" ");
    if (bits.length < 2 || !bits[1].startsWith("/auth/callback?"))
      throw new SecurityException("Percorso callback OAuth non valido.");
    java.util.Map<String, String> params = new java.util.HashMap<>();
    for (String pair : bits[1].substring(bits[1].indexOf('?') + 1).split("&")) {
      String[] kv = pair.split("=", 2);
      params.put(
          java.net.URLDecoder.decode(kv[0], "UTF-8"),
          kv.length == 2 ? java.net.URLDecoder.decode(kv[1], "UTF-8") : "");
    }
    BufferedWriter out =
        new BufferedWriter(
            new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
    String page =
        "<!doctype html><meta charset=utf-8><title>Sei Mobile</title><meta name='viewport'"
            + " content='width=device-width,initial-scale=1'><body style='font:18px"
            + " sans-serif;text-align:center;padding:48px;background:#faf7fc;color:#362542'><p>Richiesta"
            + " ricevuta. Torna nell’app per verificare il collegamento e proseguire con la"
            + " chat.</p><p><a style='display:inline-block;padding:14px"
            + " 22px;background:#765b80;color:white;border-radius:12px;text-decoration:none'"
            + " href='intent://oauth-callback#Intent;scheme=seimobile;package=org.seimobile;end'>Torna"
            + " a Sei Mobile</a></p></body>";
    out.write(
        "HTTP/1.1 200 OK\r\n"
            + "Content-Type: text/html; charset=utf-8\r\n"
            + "Connection: close\r\n"
            + "Content-Length: "
            + page.getBytes(StandardCharsets.UTF_8).length
            + "\r\n\r\n"
            + page);
    out.flush();
    return new Callback(params);
  }

  private static JSONObject postForm(String target, String body) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(target).openConnection();
    c.setRequestMethod("POST");
    c.setConnectTimeout(20000);
    c.setReadTimeout(30000);
    c.setDoOutput(true);
    c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=utf-8");
    try (OutputStream out = c.getOutputStream()) {
      out.write(body.getBytes(StandardCharsets.UTF_8));
    }
    int status = c.getResponseCode();
    if (status < 200 || status >= 300) throw httpError(c, status);
    try (InputStream in = c.getInputStream()) {
      return new JSONObject(readAll(in));
    } finally {
      c.disconnect();
    }
  }

  private static JSONObject getJson(String url) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(20000);
    c.setReadTimeout(30000);
    int status = c.getResponseCode();
    if (status < 200 || status >= 300) throw httpError(c, status);
    try (InputStream in = c.getInputStream()) {
      return new JSONObject(readAll(in));
    } finally {
      c.disconnect();
    }
  }

  private static Exception httpError(HttpURLConnection c, int code) {
    try {
      InputStream e = c.getErrorStream();
      if (e != null) {
        String body = redactProviderText(readAll(e));
        try {
          JSONObject j = new JSONObject(body);
          JSONObject err = j.optJSONObject("error");
          if (err != null)
            return new IllegalStateException(
                "HTTP "
                    + code
                    + " "
                    + err.optString("code", "")
                    + ": "
                    + redactProviderText(err.optString("message", body)));
        } catch (Exception ignored) {
        }
        return new IllegalStateException(
            "HTTP " + code + ": " + body.substring(0, Math.min(body.length(), 300)));
      }
    } catch (Exception ignored) {
    }
    return new IllegalStateException("HTTP " + code);
  }

  private static String readAll(InputStream in) throws Exception {
    StringBuilder s = new StringBuilder();
    try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
      String line;
      while ((line = r.readLine()) != null) s.append(line);
    }
    return s.toString();
  }

  private static String form(String... pairs) throws Exception {
    StringBuilder b = new StringBuilder();
    for (int i = 0; i < pairs.length; i += 2) {
      if (b.length() > 0) b.append('&');
      b.append(URLEncoder.encode(pairs[i], "UTF-8"))
          .append('=')
          .append(URLEncoder.encode(pairs[i + 1], "UTF-8"));
    }
    return b.toString();
  }

  private static String randomUrlSafe(int bytes) {
    byte[] b = new byte[bytes];
    new java.security.SecureRandom().nextBytes(b);
    return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
  }

  private static boolean containsScope(String list, String wanted) {
    for (String s : list.split("\\s+")) if (s.equals(wanted)) return true;
    return false;
  }

  private static void postAuthError(AuthCallback cb, String message) {
    MAIN.post(() -> cb.onError(message));
  }

  private static String safeMessage(Exception e) {
    String m = e.getMessage();
    return m == null || m.trim().isEmpty() ? "errore inatteso." : redactProviderText(m);
  }

  private static String redactProviderText(String value) {
    return value
        .replaceAll("(?i)bearer\\s+[A-Za-z0-9._~-]+", "Bearer [redacted]")
        .replaceAll("(?i)(api[-_ ]?key|token|secret)=?\\s*[^\\s,;]+", "$1=[redacted]")
        .replaceAll("data:[^\\s,;]+", "data:[redacted]");
  }

  private static final class Callback {
    final java.util.Map<String, String> params;

    Callback(java.util.Map<String, String> p) {
      params = p;
    }
  }

  private static String secret(Context c, String name) {
    try {
      String encoded = c.getSharedPreferences(PREFS, 0).getString("enc_" + name, "");
      if (encoded.isEmpty()) return "";
      byte[] packed = Base64.decode(encoded, Base64.NO_WRAP);
      byte[] iv = java.util.Arrays.copyOfRange(packed, 0, 12);
      byte[] cipher = java.util.Arrays.copyOfRange(packed, 12, packed.length);
      Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
      aes.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
      return new String(aes.doFinal(cipher), StandardCharsets.UTF_8);
    } catch (Exception e) {
      return "";
    }
  }

  private static void putSecret(Context c, String name, String value) throws Exception {
    if (value == null || value.isEmpty())
      throw new SecurityException("Credenziale ChatGPT mancante.");
    Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
    aes.init(Cipher.ENCRYPT_MODE, key());
    byte[] iv = aes.getIV();
    byte[] encrypted = aes.doFinal(value.getBytes(StandardCharsets.UTF_8));
    byte[] packed = new byte[iv.length + encrypted.length];
    System.arraycopy(iv, 0, packed, 0, iv.length);
    System.arraycopy(encrypted, 0, packed, iv.length, encrypted.length);
    c.getSharedPreferences(PREFS, 0)
        .edit()
        .putString("enc_" + name, Base64.encodeToString(packed, Base64.NO_WRAP))
        .apply();
  }

  private static SecretKey key() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    if (ks.containsAlias(KEY_ALIAS))
      return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
    KeyGenerator gen = KeyGenerator.getInstance("AES", "AndroidKeyStore");
    android.security.keystore.KeyGenParameterSpec spec =
        new android.security.keystore.KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT
                    | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build();
    gen.init(spec);
    return gen.generateKey();
  }
}
