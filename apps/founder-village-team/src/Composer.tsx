import { memo, type FormEvent } from "react";
import {
  messageInputSchema,
  messageSchema,
  replyInputSchema,
  type Message,
} from "./generated/contracts/index.ts";
import { type Client, useAction } from "./client.ts";

type Props = {
  client: Client;
  base: string;
  botName?: string;
  replies: boolean;
  replyTo?: string;
  onSaved: (message: Message) => void;
};

export const Composer = memo(function Composer({
  client,
  base,
  botName,
  replies,
  replyTo,
  onSaved,
}: Props) {
  const action = useAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const field = form.elements.namedItem("content") as HTMLTextAreaElement;
    const input = messageInputSchema.safeParse({ content: field.value });
    if (!input.success) {
      field.setCustomValidity("Enter a message.");
      field.reportValidity();
      return;
    }
    void action.run(["message", input.data], async (key) => {
      const saved = await client.post(
        base + "/messages",
        input.data,
        key,
        messageSchema,
      );
      onSaved(saved);
      form.reset();
      requestAnimationFrame(() => field.focus({ preventScroll: true }));
    });
  }
  return (
    <>
      {botName && replies && replyTo && (
        <div className="ask">
          <button
            disabled={action.busy}
            onClick={() => {
              const body = replyInputSchema.parse({ messageId: replyTo });
              void action.run(["reply", body], async (key) =>
                onSaved(
                  await client.post(
                    base + "/replies",
                    body,
                    key,
                    messageSchema,
                  ),
                ),
              );
            }}
          >
            Ask {botName}
          </button>
          <small>
            Shares the bot’s instructions and recent conversation with xAI.
          </small>
        </div>
      )}
      {botName && !replies && (
        <p className="muted">
          Bot replies are unavailable in this environment. You can still save
          messages.
        </p>
      )}
      <form className="composer" onSubmit={submit}>
        <label htmlFor="message">Message</label>
        <textarea
          name="content"
          id="message"
          placeholder="Write a message…"
          required
          maxLength={12000}
          rows={3}
          disabled={action.busy}
          onInput={(e) => e.currentTarget.setCustomValidity("")}
        />
        <div>
          <button disabled={action.busy} className="primary">
            Save message
          </button>
        </div>
      </form>
      {action.busy && <p role="status">Working…</p>}
      {action.error && <p role="alert">{action.error}</p>}
    </>
  );
});
