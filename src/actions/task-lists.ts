"use server";

import { requireWorkspace } from "@/lib/data/workspace";
import { listTasks } from "@/lib/data/tasks";
import { fail, ok, errorMessage, type ActionResult } from "@/lib/action-result";
import type { TaskWithRefs } from "@/lib/types";

export async function listOpenTasksForPicker(): Promise<ActionResult<TaskWithRefs[]>> {
  try {
    const ws = await requireWorkspace();
    const tasks = await listTasks(ws.userId, { today: ws.today, status: "open", limit: 400 });
    return ok(tasks);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
