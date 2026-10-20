// Ripasso: pianificazione SM-2 semplificata, separata dalle route.
import { revNorm } from "./storage.mjs";

// quality: "difficile" | "media" | "facile"
export function gradeReview(item, quality, now = Date.now()) {
  revNorm(item);
  if (quality === "difficile") {
    item.lapses++;
    item.reps = 0;
    item.interval = 0;
    item.ease = Math.max(1.3, Math.round((item.ease - 0.2) * 100) / 100);
    item.due = now + 10 * 60 * 1000;
  } else if (quality === "facile") {
    item.reps++;
    item.interval = item.reps <= 1 ? 3 : item.reps === 2 ? 7 : Math.round(item.interval * item.ease * 1.15);
    item.ease = Math.min(3.2, Math.round((item.ease + 0.1) * 100) / 100);
    item.due = now + item.interval * 86400000;
  } else {
    item.reps++;
    item.interval = item.reps <= 1 ? 1 : item.reps === 2 ? 3 : Math.round(item.interval * item.ease);
    item.due = now + item.interval * 86400000;
  }
  item.lastGrade = quality === "difficile" || quality === "media" || quality === "facile" ? quality : "media";
  item.lastT = now;
  return item;
}
