import { useRef, useState } from "react";
import { userError, type Client } from "./client.ts";
import {
  messageContentChunkSchema,
  type Message,
} from "./generated/contracts/index.ts";

type RequestState =
  { status: "idle" | "loading" } | { status: "failed"; error: string };

export function LongMessage({
  client,
  message,
}: {
  client: Client;
  message: Message;
}) {
  const [text, setText] = useState({
    body: message.content,
    authorTail: "",
    offset: message.nextOffset ?? null,
  });
  const [request, setRequest] = useState<RequestState>({ status: "idle" });
  const pending = useRef(false);

  async function loadMore() {
    const { offset } = text;
    if (offset === null || pending.current) return;
    pending.current = true;
    setRequest({ status: "loading" });
    try {
      const chunk = await client.get(
        `/team/conversations/${message.conversationId}/messages/${message.id}/content?offset=${offset}`,
        messageContentChunkSchema,
      );
      if (chunk.nextOffset !== null && chunk.nextOffset <= offset)
        throw new Error("Invalid message offset");
      setText((previous) => ({
        body: previous.body + chunk.content,
        authorTail: previous.authorTail + (chunk.authorName ?? ""),
        offset: chunk.nextOffset,
      }));
      setRequest({ status: "idle" });
    } catch (cause) {
      setRequest({ status: "failed", error: userError(cause) });
    } finally {
      pending.current = false;
    }
  }
  return (
    <>
      {text.authorTail && (
        <details>
          <summary>Full author name</summary>
          <p>{(message.authorName ?? "") + text.authorTail}</p>
        </details>
      )}
      <p>{text.body}</p>
      <button
        type="button"
        onClick={() => void loadMore()}
        aria-disabled={request.status === "loading" || text.offset === null}
      >
        {text.offset === null
          ? "All text loaded"
          : request.status === "loading"
            ? "Loading text…"
            : "Load more text"}
      </button>
      {request.status === "failed" && <p role="alert">{request.error}</p>}
    </>
  );
}
