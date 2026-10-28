package org.seimobile;

import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.*;
import java.util.Arrays;

/** First shared activity: offline tic-tac-toe against the companion. */
public final class GameActivity extends CompanionActivity {
  private char[] board = new char[9];
  private final Button[] cells = new Button[9];
  private TextView state;

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    Arrays.fill(board, ' ');
    String old = getSharedPreferences("sei_game", 0).getString("board", "");
    if (old.length() == 9) board = old.toCharArray();
    layout("Tris insieme", "Tu: X  ·  " + companionName() + ": O  ·  offline");
    addAvatar(150);
    state = text("", 18, INK);
    state.setGravity(Gravity.CENTER);
    page.addView(state);
    space(12);
    GridLayout grid = new GridLayout(this);
    grid.setColumnCount(3);
    for (int i = 0; i < 9; i++) {
      final int at = i;
      cells[i] = button("", false);
      cells[i].setTextSize(30);
      cells[i].setTypeface(null, Typeface.BOLD);
      cells[i].setContentDescription("Casella " + (i + 1));
      cells[i].setOnClickListener(v -> play(at));
      GridLayout.LayoutParams p =
          new GridLayout.LayoutParams(GridLayout.spec(i / 3, 1f), GridLayout.spec(i % 3, 1f));
      p.width = 0;
      p.height = dp(74);
      p.setMargins(dp(3), dp(3), dp(3), dp(3));
      grid.addView(cells[i], p);
    }
    page.addView(grid, new LinearLayout.LayoutParams(-1, -2));
    space(16);
    Button reset = button("Nuova partita", true);
    reset.setOnClickListener(
        v -> {
          Arrays.fill(board, ' ');
          save();
          render();
          avatar.setAnimation("wave");
        });
    page.addView(reset, new LinearLayout.LayoutParams(-1, dp(54)));
    Button discuss = button("Parlane con il companion", false);
    discuss.setOnClickListener(
        v -> {
          char r = TicTacToe.result(board);
          String score =
              r == 'D'
                  ? "abbiamo pareggiato"
                  : r == 'X' ? "ho vinto" : r == 'O' ? "hai vinto tu" : "stiamo giocando";
          startActivity(
              new Intent(this, MainActivity.class)
                  .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                  .putExtra(
                      "draft_prompt",
                      "Al tris " + score + ". Ti va di parlarne o inventare una nuova sfida?"));
          finish();
        });
    page.addView(discuss, new LinearLayout.LayoutParams(-1, dp(54)));
    space(8);
    page.addView(
        text(
            "Il gioco usa un avversario locale, senza chiamate al modello. La partita resta sul"
                + " telefono.",
            12,
            MUTED));
    render();
  }

  private void play(int at) {
    if (board[at] != ' ' || TicTacToe.result(board) != ' ') return;
    board[at] = 'X';
    if (TicTacToe.result(board) == ' ') {
      int move = TicTacToe.bestMove(board);
      if (move >= 0) board[move] = 'O';
    }
    save();
    render();
    char r = TicTacToe.result(board);
    avatar.setAnimation(r == 'D' ? "nod" : r == 'O' ? "celebrate" : "look");
  }

  private void save() {
    getSharedPreferences("sei_game", 0).edit().putString("board", new String(board)).apply();
  }

  private void render() {
    char r = TicTacToe.result(board);
    for (int i = 0; i < 9; i++) {
      cells[i].setText(String.valueOf(board[i]));
      cells[i].setTextColor(board[i] == 'X' ? BLUE : 0xffa4e0bf);
      cells[i].setEnabled(board[i] == ' ' && r == ' ');
    }
    state.setText(
        r == 'X'
            ? "Hai vinto!"
            : r == 'O'
                ? companionName() + " vince. Rivincita?"
                : r == 'D' ? "Pareggio. Bella partita!" : "Tocca una casella: cominci tu.");
  }
}
