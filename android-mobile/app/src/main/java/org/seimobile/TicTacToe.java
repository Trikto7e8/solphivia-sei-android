package org.seimobile;

/** Small offline game engine. X is the player, O is the companion. */
public final class TicTacToe {
  private static final int[][] LINES = {
    {0, 1, 2}, {3, 4, 5}, {6, 7, 8}, {0, 3, 6}, {1, 4, 7}, {2, 5, 8}, {0, 4, 8}, {2, 4, 6}
  };

  public static char result(char[] board) {
    for (int[] line : LINES)
      if (board[line[0]] != ' '
          && board[line[0]] == board[line[1]]
          && board[line[1]] == board[line[2]]) return board[line[0]];
    for (char c : board) if (c == ' ') return ' ';
    return 'D';
  }

  public static int bestMove(char[] board) {
    if (result(board) != ' ') return -1;
    int score = -100, move = -1;
    for (int i : new int[] {4, 0, 2, 6, 8, 1, 3, 5, 7})
      if (board[i] == ' ') {
        board[i] = 'O';
        int value = minimax(board, false, 0);
        board[i] = ' ';
        if (value > score) {
          score = value;
          move = i;
        }
      }
    return move;
  }

  private static int minimax(char[] board, boolean companion, int depth) {
    char r = result(board);
    if (r == 'O') return 10 - depth;
    if (r == 'X') return depth - 10;
    if (r == 'D') return 0;
    int best = companion ? -100 : 100;
    for (int i = 0; i < 9; i++)
      if (board[i] == ' ') {
        board[i] = companion ? 'O' : 'X';
        int score = minimax(board, !companion, depth + 1);
        board[i] = ' ';
        best = companion ? Math.max(best, score) : Math.min(best, score);
      }
    return best;
  }

  private TicTacToe() {}
}
