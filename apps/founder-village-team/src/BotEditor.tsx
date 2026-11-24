import { memo, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  botInputSchema,
  botUpdateSchema,
  botSchema,
  type Bot,
} from "./generated/contracts/index.ts";
import { useAction, type Client } from "./client.ts";

// Browser-owned fields retain focus and selection while typing. Re-evaluate the
// submit button only when its validity or the in-flight request changes.
export function RequiredSubmit({
  field,
  busy,
  children,
}: {
  field: string;
  busy: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const button = ref.current;
    const input = button?.form?.elements.namedItem(field);
    if (!button || !(input instanceof HTMLInputElement)) return;
    const sync = () => {
      const disabled = busy || !input.value.trim();
      if (button.disabled !== disabled) button.disabled = disabled;
    };
    sync();
    input.addEventListener("input", sync);
    return () => input.removeEventListener("input", sync);
  }, [busy, field]);
  return (
    <button ref={ref} type="submit" className="primary">
      {children}
    </button>
  );
}
const ImportedConfiguration = memo(function ImportedConfiguration({
  configuration,
}: {
  configuration: Bot["configuration"];
}) {
  if (!configuration || Object.keys(configuration).length === 0) return null;
  return (
    <details>
      <summary>Imported configuration</summary>
      <dl>
        {Object.entries(configuration).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{Array.isArray(value) ? value.join("\n") : value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
});
export const BotEditor = memo(function BotEditor({
  bot,
  client,
  done,
  cancel,
}: {
  bot?: Bot;
  client: Client;
  done: (b: Bot) => void;
  cancel: () => void;
}) {
  const action = useAction();
  return (
    <section className="editor">
      <button className="back" onClick={cancel}>
        ← Team bots
      </button>
      <h1>{bot ? "Configure bot" : "Create bot"}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const fields = {
            name: data.get("name"),
            description: data.get("description"),
            instructions: data.get("instructions"),
          };
          const body = bot
            ? botUpdateSchema.parse(fields)
            : botInputSchema.parse({
                ...fields,
                visibility: data.get("visibility"),
              });
          void action.run(body, async (key) =>
            done(
              await client.post(
                bot ? "/team/bots/" + bot.id : "/team/bots",
                body,
                key,
                botSchema,
              ),
            ),
          );
        }}
      >
        <label>
          Bot name
          <input
            name="name"
            required
            pattern={".*\\S.*"}
            maxLength={240}
            defaultValue={bot?.name ?? ""}
          />
        </label>
        <label>
          Description
          <input
            name="description"
            maxLength={2000}
            defaultValue={bot?.description ?? ""}
          />
        </label>
        <label>
          Instructions
          <textarea
            name="instructions"
            rows={6}
            maxLength={10000}
            defaultValue={bot?.instructions ?? ""}
          />
        </label>
        {!bot && (
          <label>
            Who can use this bot?
            <select name="visibility" defaultValue="private">
              <option value="private">Only me</option>
              <option value="team">Everyone in this team</option>
            </select>
          </label>
        )}
        {bot && <ImportedConfiguration configuration={bot.configuration} />}
        {action.error && <p role="alert">{action.error}</p>}
        <RequiredSubmit field="name" busy={action.busy}>
          {action.busy ? "Saving…" : "Save bot"}
        </RequiredSubmit>
      </form>
    </section>
  );
});
