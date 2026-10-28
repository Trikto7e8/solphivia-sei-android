package org.seimobile;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.view.*;
import android.widget.*;

/** Shared native presentation for game and voice surfaces. */
abstract class CompanionActivity extends Activity {
  protected static final int BG = 0xff101725,
      PANEL = 0xff1a2538,
      INK = 0xffeef4ff,
      MUTED = 0xffa4b4cd,
      BLUE = 0xff9cc5ff;
  protected LinearLayout page;
  protected PetView avatar;

  protected int dp(float n) {
    return (int) (n * getResources().getDisplayMetrics().density + .5f);
  }

  protected TextView text(String s, int size, int color) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextColor(color);
    t.setTextSize(size);
    return t;
  }

  protected Button button(String s, boolean primary) {
    Button b = new Button(this);
    b.setText(s);
    b.setAllCaps(false);
    b.setTextColor(primary ? BG : INK);
    b.setBackgroundTintList(ColorStateList.valueOf(primary ? BLUE : 0xff30415c));
    b.setMinHeight(dp(50));
    return b;
  }

  protected String companionName() {
    return getSharedPreferences("sei_mobile", 0).getString("name", "Solphivia");
  }

  protected void layout(String title, String subtitle) {
    getWindow().setStatusBarColor(BG);
    getWindow().setNavigationBarColor(BG);
    page = new LinearLayout(this);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setBackgroundColor(BG);
    page.setPadding(dp(20), dp(16), dp(20), dp(16));
    page.setOnApplyWindowInsetsListener(
        (v, i) -> {
          v.setPadding(
              dp(20) + i.getSystemWindowInsetLeft(),
              dp(16) + i.getSystemWindowInsetTop(),
              dp(20) + i.getSystemWindowInsetRight(),
              dp(16) + i.getSystemWindowInsetBottom());
          return i.consumeSystemWindowInsets();
        });
    LinearLayout top = new LinearLayout(this);
    TextView h = text(title, 23, INK);
    h.setTypeface(null, Typeface.BOLD);
    top.addView(h, new LinearLayout.LayoutParams(0, -2, 1));
    Button back = button("Chiudi", false);
    back.setOnClickListener(v -> finish());
    top.addView(back);
    page.addView(top);
    page.addView(text(subtitle, 13, MUTED));
    setContentView(page);
  }

  protected void addAvatar(int height) {
    avatar = new PetView(this);
    avatar.setContentDescription("Solphivia, avatar del companion");
    page.addView(avatar, new LinearLayout.LayoutParams(-1, dp(height)));
    avatar.setAnimation("idle");
  }

  protected void space(int h) {
    page.addView(new View(this), new LinearLayout.LayoutParams(1, dp(h)));
  }

  @Override
  protected void onPause() {
    if (avatar != null) avatar.pause();
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (avatar != null) avatar.setAnimation("idle");
  }
}
