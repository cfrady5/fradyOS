"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { loadTask } from "@/actions/tasks";
import { loadSocialPost } from "@/actions/social";
import type { TaskDetail } from "@/lib/data/tasks";
import type { SocialPostDetail } from "@/lib/data/social";
import { useOpenItem } from "@/hooks/use-open-item";
import { TaskEditor } from "./task-editor";
import { SocialPostEditor } from "./social-post-editor";
import { Button } from "@/components/ui/button";

/**
 * Global detail panel. Opens when the URL contains ?task=ID or ?post=ID so any list
 * anywhere in the app can open an item without navigating away.
 */
export function ItemSheet() {
  const params = useSearchParams();
  const { close } = useOpenItem();
  const taskId = params.get("task");
  const postId = params.get("post");
  const open = Boolean(taskId || postId);

  return (
    <Sheet open={open} onOpenChange={(v) => (!v ? close() : null)}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl" showCloseButton>
        <SheetTitle className="sr-only">{taskId ? "Task details" : "Social post details"}</SheetTitle>
        <SheetDescription className="sr-only">Edit the selected item.</SheetDescription>
        {open ? <ItemSheetBody key={taskId ? `task:${taskId}` : `post:${postId}`} taskId={taskId} postId={postId} onClose={close} /> : null}
      </SheetContent>
    </Sheet>
  );
}

type State = { loading: boolean; error: string | null; task: TaskDetail | null; post: SocialPostDetail | null };

function ItemSheetBody({ taskId, postId, onClose }: { taskId: string | null; postId: string | null; onClose: () => void }) {
  const router = useRouter();
  const [state, setState] = React.useState<State>({ loading: true, error: null, task: null, post: null });
  const version = React.useRef(0);

  const reload = React.useCallback(async () => {
    const v = ++version.current;
    if (taskId) {
      const res = await loadTask(taskId);
      if (v !== version.current) return;
      setState((s) => (res.ok ? { ...s, loading: false, task: res.data, error: null } : { ...s, loading: false, error: res.error }));
    } else if (postId) {
      const res = await loadSocialPost(postId);
      if (v !== version.current) return;
      setState((s) => (res.ok ? { ...s, loading: false, post: res.data, error: null } : { ...s, loading: false, error: res.error }));
    }
  }, [taskId, postId]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  function afterChange() {
    router.refresh();
    reload();
  }

  if (state.loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-destructive text-sm">{state.error}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => reload()}>
            Retry
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    );
  }
  if (state.task) return <TaskEditor key={state.task.task.id + state.task.task.updated_at} detail={state.task} onChanged={afterChange} onClose={onClose} />;
  if (state.post) return <SocialPostEditor key={state.post.post.id + state.post.post.updated_at} detail={state.post} onChanged={afterChange} onClose={onClose} />;
  return null;
}
