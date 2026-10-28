package org.seimobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.Log;
import android.view.Choreographer;
import android.view.View;
import java.io.IOException;
import java.io.InputStream;

/** Sprite-state controller for Solphivia's expressions, movement, rest, and outfits. */
public class PetView extends View {
  private static final java.util.concurrent.ExecutorService SPRITE_LOADER =
      java.util.concurrent.Executors.newSingleThreadExecutor();
  private static final java.util.Map<String, java.util.List<java.lang.ref.WeakReference<Bitmap>>>
      SPRITES = new java.util.HashMap<>();
  private static final android.os.Handler MAIN =
      new android.os.Handler(android.os.Looper.getMainLooper());
  private static final String TAG = "SolphiviaPet";
  private static final int IDLE_FRAME_COUNT = 4;
  private static final int ACTION_FRAME_COUNT = 8;
  private static final long IDLE_FRAME_MS = 760;
  private static final long ACTION_FRAME_MS = 145;
  private static final int[] CLOSED_MOUTH_IDLE = {0, 2, 5, 0};

  private final Bitmap[] idleFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] talkFrames = new Bitmap[ACTION_FRAME_COUNT];
  private final Bitmap[] cyborgFrames = new Bitmap[ACTION_FRAME_COUNT];
  private final Bitmap[] lookFrames = new Bitmap[ACTION_FRAME_COUNT];
  private final Bitmap[] listenFrames = new Bitmap[ACTION_FRAME_COUNT];
  private final Bitmap[] emotionFrames = new Bitmap[ACTION_FRAME_COUNT];
  private final Bitmap[] runFrames = new Bitmap[ACTION_FRAME_COUNT];
  private final Bitmap[] cyborgRunFrames = new Bitmap[ACTION_FRAME_COUNT];
  private final Bitmap[] sitFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] sleepFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] cyborgSitFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] cyborgSleepFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] professorModeFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] vjModeFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] vjJacketFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] vjWaveFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] codexModeFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] rainWeatherFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] sunWeatherFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Bitmap[] coldWeatherFrames = new Bitmap[IDLE_FRAME_COUNT];
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
  private final RectF destination = new RectF();
  private boolean runLoopScheduled;
  private long runCycleStartedAt;
  private int runFrameIndex;
  private boolean running = true;
  private String animation = "idle";
  private long animationStartedAt = android.os.SystemClock.uptimeMillis();
  private final Choreographer.FrameCallback runFrameCallback = this::onRunFrame;

  private void onRunFrame(long frameTimeNanos) {
    if (!running || !isAttachedToWindow() || !"run".equals(animation)) {
      runLoopScheduled = false;
      return;
    }
    long elapsedMs = Math.max(0L, android.os.SystemClock.uptimeMillis() - runCycleStartedAt);
    int nextFrame = (int) ((elapsedMs / 85L) % ACTION_FRAME_COUNT);
    if (nextFrame != runFrameIndex) {
      runFrameIndex = nextFrame;
      invalidate();
    }
    Choreographer.getInstance().postFrameCallback(runFrameCallback);
  }

  private boolean cyborgSuit;
  private boolean classicCyborgOverride;
  private String solphiviaMode = "prof";
  private String weatherLook = "none";

  public PetView(Context context) {
    super(context);
    setContentDescription("Solphivia animata: trascina per spostarla, tocca per interagire");
    BitmapFactory.Options options = new BitmapFactory.Options();
    options.inScaled = false;
    loadFrames(context, "talk", talkFrames, options);
    loadFrames(context, "cyborg", cyborgFrames, options);
    loadFrames(context, "look", lookFrames, options);
    loadFrames(context, "listen", listenFrames, options);
    loadFrames(context, "emotion", emotionFrames, options);
    loadFrames(context, "run", runFrames, options);
    loadFrames(context, "cyborg_run", cyborgRunFrames, options);
    loadFrames(context, "sit", sitFrames, options);
    loadFrames(context, "sleep", sleepFrames, options);
    loadFrames(context, "cyborg_sit", cyborgSitFrames, options);
    loadFrames(context, "cyborg_sleep", cyborgSleepFrames, options);
    loadFrames(context, "mode_prof", professorModeFrames, options);
    loadFrames(context, "mode_vj", vjModeFrames, options);
    loadFrames(context, "mode_vj_jacket", vjJacketFrames, options);
    loadFrames(context, "vj_wave", vjWaveFrames, options);
    loadFrames(context, "mode_codex", codexModeFrames, options);
    loadFrames(context, "weather_rain", rainWeatherFrames, options);
    loadFrames(context, "weather_sun", sunWeatherFrames, options);
    loadFrames(context, "weather_cold", coldWeatherFrames, options);
    loadFrames(context, "idle", idleFrames, options);
  }

  private void loadFrames(
      Context context, String name, Bitmap[] target, BitmapFactory.Options options) {
    Context app = context.getApplicationContext();
    java.lang.ref.WeakReference<PetView> view = new java.lang.ref.WeakReference<>(this);
    SPRITE_LOADER.execute(
        () -> {
          java.util.List<java.lang.ref.WeakReference<Bitmap>> cached = SPRITES.get(name);
          Bitmap[] frames = new Bitmap[target.length];
          java.util.List<java.lang.ref.WeakReference<Bitmap>> references =
              new java.util.ArrayList<>();
          for (int i = 0; i < frames.length; i++) {
            frames[i] = cached != null && i < cached.size() ? cached.get(i).get() : null;
            if (frames[i] == null) {
              String path =
                  String.format(java.util.Locale.ROOT, "solphivia/%s/frame_%02d.png", name, i);
              try (InputStream input = app.getAssets().open(path)) {
                frames[i] = BitmapFactory.decodeStream(input, null, options);
              } catch (IOException | RuntimeException error) {
                Log.e(TAG, "Impossibile caricare " + path, error);
              }
            }
            references.add(new java.lang.ref.WeakReference<>(frames[i]));
          }
          // Keep weak references to the bitmaps held by live views, rather than a temporary array.
          SPRITES.put(name, references);
          Bitmap[] ready = frames;
          MAIN.post(
              () -> {
                PetView current = view.get();
                if (current == null) return;
                System.arraycopy(ready, 0, target, 0, target.length);
                current.invalidate();
              });
        });
  }

  public void pause() {
    running = false;
    stopRunLoop();
  }

  public void setCyborgSuit(boolean enabled) {
    if (cyborgSuit == enabled) return;
    cyborgSuit = enabled;
    invalidate();
  }

  /** Preserve the original cyborg costume command independently from the three new modes. */
  public void setClassicCyborgSuit(boolean enabled) {
    classicCyborgOverride = enabled;
    cyborgSuit = enabled;
    invalidate();
  }

  public boolean isCyborgSuit() {
    return cyborgSuit;
  }

  /** Select the dedicated four-frame idle loop for a Solphivia mode. */
  public void setSolphiviaMode(String mode) {
    if (mode == null) return;
    String value = mode.trim().toLowerCase(java.util.Locale.ROOT);
    if (!value.equals("prof")
        && !value.equals("vj")
        && !value.equals("codex")
        && !value.equals("meteorina")) return;
    classicCyborgOverride = false;
    if (solphiviaMode.equals(value)) {
      invalidate();
      return;
    }
    solphiviaMode = value;
    if ("idle".equals(animation) || "mode".equals(animation)) {
      animation = "mode";
      animationStartedAt = android.os.SystemClock.uptimeMillis();
    }
    invalidate();
  }

  public String getSolphiviaMode() {
    return solphiviaMode;
  }

  /** Weather outfit loops temporarily replace the selected mode's idle sprite. */
  public void setWeatherLook(String look) {
    if (look == null) return;
    String value = look.trim().toLowerCase(java.util.Locale.ROOT);
    if (!value.equals("none")
        && !value.equals("rain")
        && !value.equals("sun")
        && !value.equals("cold")) return;
    if (weatherLook.equals(value)) return;
    weatherLook = value;
    if ("idle".equals(animation) || "mode".equals(animation))
      animationStartedAt = android.os.SystemClock.uptimeMillis();
    invalidate();
  }

  private Bitmap[] currentWeatherFrames() {
    if (!"meteorina".equals(solphiviaMode) || classicCyborgOverride) return null;
    switch (weatherLook) {
      case "rain":
        return rainWeatherFrames;
      case "sun":
        return sunWeatherFrames;
      case "cold":
        return coldWeatherFrames;
      default:
        return null;
    }
  }

  private Bitmap[] currentModeFrames() {
    switch (solphiviaMode) {
      case "vj":
        return vjJacketFrames[0] != null ? vjJacketFrames : vjModeFrames;
      case "codex":
        return codexModeFrames;
      default:
        return professorModeFrames;
    }
  }

  public String getSolphiviaAnimation() {
    return animation;
  }

  /** Apply a whitelisted animation command from the assistant layer. */
  public boolean setAnimation(String command) {
    if (command == null) return false;
    String next = command.trim().toLowerCase(java.util.Locale.ROOT);
    switch (next) {
      case "idle":
      case "mode":
      case "look":
      case "thinking":
      case "listen":
      case "talk":
      case "sit":
      case "sleep":
      case "happy":
      case "concerned":
      case "sad":
      case "run":
      case "wave":
      case "nod":
      case "explain":
      case "celebrate":
        if ("run".equals(next) && "run".equals(animation) && runLoopScheduled) {
          running = true;
          return true;
        }
        if (!"run".equals(next)) stopRunLoop();
        animation = next;
        animationStartedAt = android.os.SystemClock.uptimeMillis();
        runFrameIndex = 0;
        running = true;
        if ("run".equals(next) && isAttachedToWindow()) startRunLoop();
        invalidate();
        return true;
      default:
        return false;
    }
  }

  @Override
  protected void onAttachedToWindow() {
    super.onAttachedToWindow();
    running = true;
    if ("run".equals(animation)) startRunLoop();
    invalidate();
  }

  @Override
  protected void onDetachedFromWindow() {
    running = false;
    stopRunLoop();
    super.onDetachedFromWindow();
  }

  private void startRunLoop() {
    if (runLoopScheduled) return;
    runLoopScheduled = true;
    runCycleStartedAt = android.os.SystemClock.uptimeMillis();
    runFrameIndex = 0;
    Choreographer.getInstance().postFrameCallback(runFrameCallback);
  }

  private void stopRunLoop() {
    if (runLoopScheduled) Choreographer.getInstance().removeFrameCallback(runFrameCallback);
    runLoopScheduled = false;
  }

  @Override
  public boolean performClick() {
    super.performClick();
    return true;
  }

  @Override
  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    long now = android.os.SystemClock.uptimeMillis();
    long elapsed = now - animationStartedAt;
    Bitmap[] voiceFrames = cyborgSuit ? cyborgFrames : talkFrames;
    Bitmap frame;
    boolean animate = true;
    switch (animation) {
      case "idle":
      case "mode":
        Bitmap[] weatherFrames = currentWeatherFrames();
        if (weatherFrames != null && weatherFrames[0] != null)
          frame = weatherFrames[(int) (elapsed / 520L) % IDLE_FRAME_COUNT];
        else
          frame =
              classicCyborgOverride
                  ? voiceFrames[
                      CLOSED_MOUTH_IDLE[(int) (elapsed / IDLE_FRAME_MS) % IDLE_FRAME_COUNT]]
                  : currentModeFrames()[(int) (elapsed / 520L) % IDLE_FRAME_COUNT];
        break;
      case "look":
      case "thinking":
        if ("look".equals(animation) && elapsed >= ACTION_FRAME_COUNT * ACTION_FRAME_MS) {
          animation = "idle";
          animationStartedAt = now;
          frame = voiceFrames[CLOSED_MOUTH_IDLE[0]];
        } else if (cyborgSuit) {
          int calm = CLOSED_MOUTH_IDLE[(int) (elapsed / IDLE_FRAME_MS) % IDLE_FRAME_COUNT];
          frame = voiceFrames[calm];
        } else frame = lookFrames[(int) (elapsed / ACTION_FRAME_MS) % ACTION_FRAME_COUNT];
        break;
      case "nod":
      case "explain":
      case "celebrate":
        Bitmap[] contextualFrames = currentWeatherFrames();
        if (contextualFrames == null || contextualFrames[0] == null)
          contextualFrames = currentModeFrames();
        frame =
            classicCyborgOverride
                ? voiceFrames[CLOSED_MOUTH_IDLE[0]]
                : contextualFrames[(int) (elapsed / 520L) % IDLE_FRAME_COUNT];
        if (elapsed >= 1800L) {
          animation = "idle";
          animationStartedAt = now;
        }
        break;
      case "listen":
        if (cyborgSuit) {
          frame =
              voiceFrames[CLOSED_MOUTH_IDLE[(int) (elapsed / IDLE_FRAME_MS) % IDLE_FRAME_COUNT]];
        } else frame = listenFrames[(int) (elapsed / ACTION_FRAME_MS) % ACTION_FRAME_COUNT];
        break;
      case "talk":
        frame = voiceFrames[(int) (elapsed / 115) % ACTION_FRAME_COUNT];
        break;
      case "run":
        Bitmap[] cycle = cyborgSuit ? cyborgRunFrames : runFrames;
        if (runLoopScheduled) {
          frame = cycle[runFrameIndex];
          animate =
              false; // The run cycle resynchronizes to Android display frames and elapsed time.
        } else {
          frame = cycle[(int) (elapsed / 95) % ACTION_FRAME_COUNT];
        }
        break;
      case "wave":
        int waveIndex = (int) (elapsed / 185L);
        if (waveIndex >= IDLE_FRAME_COUNT) {
          animation = "idle";
          animationStartedAt = now;
          Bitmap[] weatherAfterWave = currentWeatherFrames();
          frame =
              weatherAfterWave != null && weatherAfterWave[0] != null
                  ? weatherAfterWave[0]
                  : currentModeFrames()[0];
        } else {
          frame =
              vjWaveFrames[waveIndex] != null
                  ? vjWaveFrames[waveIndex]
                  : currentModeFrames()[waveIndex];
        }
        break;
      case "sit":
        Bitmap[] sitting = cyborgSuit ? cyborgSitFrames : sitFrames;
        frame = sitting[(int) (elapsed / IDLE_FRAME_MS) % IDLE_FRAME_COUNT];
        break;
      case "sleep":
        Bitmap[] sleeping = cyborgSuit ? cyborgSleepFrames : sleepFrames;
        frame = sleeping[(int) (elapsed / IDLE_FRAME_MS) % IDLE_FRAME_COUNT];
        break;
      case "happy":
        frame = cyborgSuit ? cyborgFrames[1] : emotionFrames[7];
        animate = false;
        break;
      case "concerned":
        frame = cyborgSuit ? cyborgFrames[0] : emotionFrames[0];
        animate = false;
        break;
      case "sad":
        frame = cyborgSuit ? cyborgFrames[0] : emotionFrames[4];
        animate = false;
        break;
      default:
        frame = voiceFrames[CLOSED_MOUTH_IDLE[(int) (elapsed / IDLE_FRAME_MS) % IDLE_FRAME_COUNT]];
        break;
    }
    if (frame == null) frame = idleFrames[0];
    if (frame != null) {
      float scale =
          Math.min(getWidth() / (float) frame.getWidth(), getHeight() / (float) frame.getHeight());
      float width = frame.getWidth() * scale, height = frame.getHeight() * scale;
      destination.set(
          (getWidth() - width) / 2f, getHeight() - height, (getWidth() + width) / 2f, getHeight());
      boolean reduced =
          getContext().getSharedPreferences("pet", 0).getBoolean("reduced_animations", false);
      if (!reduced
          && (animation.equals("nod")
              || animation.equals("explain")
              || animation.equals("celebrate"))) {
        float phase = (float) (Math.min(elapsed, 1800L) / 1800.0 * Math.PI * 2);
        canvas.save();
        if (animation.equals("nod"))
          canvas.scale(
              1f,
              1f - 0.025f * (float) Math.sin(phase) * (float) Math.sin(phase),
              getWidth() / 2f,
              getHeight());
        else if (animation.equals("explain"))
          canvas.rotate(1.5f * (float) Math.sin(phase), getWidth() / 2f, getHeight() * 0.65f);
        else
          canvas.translate(
              0,
              -getResources().getDisplayMetrics().density
                  * 5f
                  * (float) Math.sin(phase)
                  * (float) Math.sin(phase));
        canvas.drawBitmap(frame, null, destination, paint);
        canvas.restore();
      } else if (!reduced && (animation.equals("idle") || animation.equals("mode"))) {
        float phase =
            (elapsed % (IDLE_FRAME_MS * IDLE_FRAME_COUNT))
                / (float) (IDLE_FRAME_MS * IDLE_FRAME_COUNT)
                * (float) (Math.PI * 2);
        float density = getResources().getDisplayMetrics().density;
        canvas.save();
        canvas.translate(
            (float) Math.sin(phase) * density * 0.8f,
            (float) Math.sin(phase * 2f) * density * 1.3f);
        canvas.drawBitmap(frame, null, destination, paint);
        canvas.restore();
      } else canvas.drawBitmap(frame, null, destination, paint);
    }
    if (running && isShown() && animate)
      postInvalidateDelayed("sleep".equals(animation) ? IDLE_FRAME_MS : 55);
  }
}
