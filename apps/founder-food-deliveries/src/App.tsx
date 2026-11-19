import {
  beginSignIn,
  clearSession,
  completeSignIn,
  hasOidc,
  loadSession,
  runtimeConfig,
  saveDevelopmentSession,
  uuid,
  type BrowserSession,
  type RuntimeConfig,
} from "@founder-village/frontend-platform";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { foodDeliveryApi } from "./api.ts";
import type {
  FoodDelivery,
  FoodDeliveryInput,
  FounderProfile,
  FounderTenant,
} from "./generated/contracts/index.ts";

type Provider = FoodDeliveryInput["provider"];

type FormState = {
  provider: Provider;
  providerOrderId: string;
  restaurantName: string;
  deliveryAddress: string;
  subtotal: string;
  deliveryFee: string;
  serviceFee: string;
  expectedAt: string;
  notes: string;
};

function localExpectedTime(): string {
  const date = new Date(Date.now() + 45 * 60_000);
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const initialForm = (): FormState => ({
  provider: "ifood",
  providerOrderId: "",
  restaurantName: "",
  deliveryAddress: "Founder Village reception",
  subtotal: "",
  deliveryFee: "0.00",
  serviceFee: "0.00",
  expectedAt: localExpectedTime(),
  notes: "",
});

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function cents(value: string): number {
  const amount = Number(value.replace(",", "."));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function formatMoney(value: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function providerName(provider: Provider): string {
  return provider === "ifood" ? "iFood" : "99Food";
}

function statusName(status: FoodDelivery["status"]): string {
  return status.replaceAll("_", " ");
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  );
}

function BowlIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11h16a8 8 0 0 1-16 0Z" />
      <path d="M8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4M7 20h10" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 21V7l8-4 8 4v14M8 10h2M14 10h2M8 14h2M14 14h2M9 21v-3h6v3" />
    </svg>
  );
}

export function App() {
  const [config] = useState<RuntimeConfig | Error>(() => {
    try {
      return runtimeConfig();
    } catch (error) {
      return error instanceof Error
        ? error
        : new Error("Runtime configuration failed.");
    }
  });
  const [session, setSession] = useState<BrowserSession | undefined>(() =>
    loadSession(),
  );
  const [tenants, setTenants] = useState<FounderTenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [profile, setProfile] = useState<FounderProfile>();
  const [deliveries, setDeliveries] = useState<FoodDelivery[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [developerToken, setDeveloperToken] = useState("");

  const api = useMemo(
    () =>
      config instanceof Error || !session
        ? undefined
        : foodDeliveryApi(config, session),
    [config, session],
  );

  const totalCents =
    cents(form.subtotal) + cents(form.deliveryFee) + cents(form.serviceFee);

  useEffect(() => {
    if (config instanceof Error || !hasOidc(config)) return;
    let active = true;
    void completeSignIn(config)
      .then((next) => {
        if (active && next) setSession(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      });
    return () => {
      active = false;
    };
  }, [config]);

  useEffect(() => {
    if (!api) {
      setTenants([]);
      setTenantId("");
      setProfile(undefined);
      setDeliveries([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void api
      .tenants()
      .then((next) => {
        if (!active) return;
        setTenants(next);
        const remembered = sessionStorage.getItem(
          "founder-village.food-deliveries.tenant",
        );
        setTenantId(
          next.some((tenant) => tenant.id === remembered)
            ? remembered!
            : (next[0]?.id ?? ""),
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!api || !tenantId) {
      setProfile(undefined);
      setDeliveries([]);
      return;
    }
    sessionStorage.setItem("founder-village.food-deliveries.tenant", tenantId);
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([api.profile(tenantId), api.deliveries(tenantId)])
      .then(([nextProfile, nextDeliveries]) => {
        if (!active) return;
        setProfile(nextProfile);
        setDeliveries(nextDeliveries);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, tenantId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !tenantId || totalCents <= 0) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const created = await api.create(
        tenantId,
        {
          provider: form.provider,
          providerOrderId: form.providerOrderId,
          restaurantName: form.restaurantName,
          deliveryAddress: form.deliveryAddress,
          subtotalCents: cents(form.subtotal),
          deliveryFeeCents: cents(form.deliveryFee),
          serviceFeeCents: cents(form.serviceFee),
          expectedAt: form.expectedAt
            ? new Date(form.expectedAt).toISOString()
            : undefined,
          notes: form.notes || undefined,
        },
        uuid(),
      );
      setDeliveries((current) => [
        created,
        ...current.filter((delivery) => delivery.id !== created.id),
      ]);
      setProfile((current) =>
        current
          ? {
              ...current,
              balance: {
                ...current.balance,
                balanceCents: current.balance.balanceCents + created.totalCents,
              },
            }
          : current,
      );
      setForm((current) => ({
        ...initialForm(),
        provider: current.provider,
        deliveryAddress: current.deliveryAddress,
      }));
      setNotice(
        providerName(created.provider) +
          " delivery recorded. One posted expense was added to your village balance.",
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSubmitting(false);
    }
  }

  function signOut() {
    clearSession();
    setSession(undefined);
    setNotice("");
    setError("");
  }

  function connectDeveloper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setSession(saveDevelopmentSession(developerToken));
      setDeveloperToken("");
      setError("");
    } catch (cause) {
      setError(message(cause));
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Founder Food Deliveries home">
          <span className="brand-mark">
            <BowlIcon />
          </span>
          <span>
            <strong>Founder Village</strong>
            <small>Food deliveries</small>
          </span>
        </a>
        <div className="topbar-actions">
          <span className={"connection " + (session ? "online" : "")}>
            <span aria-hidden="true" />
            {session ? "Connected" : "Sign-in needed"}
          </span>
          {session ? (
            <button className="text-button" onClick={signOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow">Shared account · clear personal tab</span>
            <h1 id="hero-title">
              Record food orders. Keep the village tab clear.
            </h1>
            <p>
              Already ordered with Founder Village&apos;s iFood or 99Food
              account? Add the receipt here and we&apos;ll post one matching
              expense to your founder balance.
            </p>
            <div className="hero-points" aria-label="How recording works">
              <span>
                <BowlIcon /> iFood + 99Food
              </span>
              <span>
                <ReceiptIcon /> One order, one expense
              </span>
              <span>
                <BuildingIcon /> Shared founder profile
              </span>
            </div>
          </div>
          <div className="receipt-art" aria-hidden="true">
            <span className="receipt-ticket">
              <BowlIcon />
              <i />
              <i />
              <i />
              <strong>R$</strong>
            </span>
            <span className="receipt-stamp">posted</span>
          </div>
        </section>

        {config instanceof Error ? (
          <section className="state-card error-card" role="alert">
            <strong>Configuration needed</strong>
            <p>{config.message}</p>
          </section>
        ) : !session ? (
          <section className="signin-card" aria-labelledby="signin-title">
            <div>
              <span className="step-number">01</span>
              <h2 id="signin-title">Connect your founder account</h2>
              <p>
                Your companies, current village balance, and food receipts are
                private and load only after sign-in.
              </p>
            </div>
            <div className="signin-actions">
              {hasOidc(config) ? (
                <button
                  className="primary-button"
                  onClick={() => void beginSignIn(config)}
                >
                  Sign in securely <span aria-hidden="true">→</span>
                </button>
              ) : (
                <p className="quiet">
                  Production sign-in has not been configured yet.
                </p>
              )}
              {import.meta.env.DEV ? (
                <details className="developer-access">
                  <summary>Local developer access</summary>
                  <form onSubmit={connectDeveloper}>
                    <label htmlFor="developer-token">
                      Local runtime access token
                    </label>
                    <textarea
                      id="developer-token"
                      value={developerToken}
                      onChange={(event) =>
                        setDeveloperToken(event.target.value)
                      }
                      rows={3}
                      autoComplete="off"
                      required
                    />
                    <button className="secondary-button">
                      Connect local session
                    </button>
                  </form>
                </details>
              ) : null}
            </div>
          </section>
        ) : (
          <>
            <section className="account-bar" aria-label="Founder account">
              <div className="tenant-choice">
                <span className="mini-label">Village account</span>
                {tenants.length > 1 ? (
                  <select
                    aria-label="Village"
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                  >
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong>{tenants[0]?.name ?? "No village membership"}</strong>
                )}
              </div>
              {profile ? (
                <>
                  <div className="founder-summary">
                    <span className="avatar" aria-hidden="true">
                      {profile.fullName.charAt(0)}
                    </span>
                    <div>
                      <span className="mini-label">Founder</span>
                      <strong>{profile.fullName}</strong>
                      {profile.room ? <small>{profile.room}</small> : null}
                    </div>
                  </div>
                  <div className="balance-summary">
                    <span className="mini-label">
                      Amount owed to the village
                    </span>
                    <strong>
                      {formatMoney(
                        profile.balance.balanceCents,
                        profile.balance.currency,
                      )}
                    </strong>
                  </div>
                </>
              ) : null}
              {loading ? (
                <span className="loading" role="status">
                  Refreshing…
                </span>
              ) : null}
            </section>

            {profile ? (
              <section className="company-strip" aria-label="Your companies">
                <span>
                  <BuildingIcon />
                  Companies
                </span>
                <div>
                  {profile.companies.length ? (
                    profile.companies.map((company) => (
                      <span className="company-chip" key={company.id}>
                        {company.name}
                      </span>
                    ))
                  ) : (
                    <span className="quiet">No companies linked yet</span>
                  )}
                </div>
              </section>
            ) : null}

            {tenantId ? (
              <div className="workspace-grid">
                <form className="order-card" onSubmit={submit}>
                  <div className="section-heading">
                    <span className="step-number">02</span>
                    <div>
                      <h2>Record a food delivery</h2>
                      <p>
                        Copy the totals from the provider receipt. We calculate
                        the expense on the server.
                      </p>
                    </div>
                  </div>

                  <fieldset className="provider-fieldset">
                    <legend>Where was the order placed?</legend>
                    <div className="provider-grid">
                      {(["ifood", "99food"] as const).map((provider) => (
                        <label
                          key={provider}
                          className={
                            "provider-option provider-" +
                            provider +
                            (form.provider === provider ? " selected" : "")
                          }
                        >
                          <input
                            type="radio"
                            name="provider"
                            value={provider}
                            checked={form.provider === provider}
                            onChange={() =>
                              setForm((current) => ({
                                ...current,
                                provider,
                              }))
                            }
                          />
                          <span className="provider-monogram">
                            {provider === "ifood" ? "iF" : "99"}
                          </span>
                          <span>
                            <strong>{providerName(provider)}</strong>
                            <small>Founder Village account</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="form-grid">
                    <label>
                      {providerName(form.provider)} order ID
                      <input
                        value={form.providerOrderId}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            providerOrderId: event.target.value,
                          }))
                        }
                        placeholder="Example: 1234-5678"
                        minLength={2}
                        maxLength={80}
                        required
                      />
                    </label>
                    <label>
                      Restaurant
                      <input
                        value={form.restaurantName}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            restaurantName: event.target.value,
                          }))
                        }
                        placeholder="Restaurant name"
                        minLength={2}
                        maxLength={160}
                        required
                      />
                    </label>
                    <label className="wide">
                      Delivery address
                      <input
                        value={form.deliveryAddress}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            deliveryAddress: event.target.value,
                          }))
                        }
                        minLength={3}
                        maxLength={240}
                        required
                      />
                    </label>
                  </div>

                  <fieldset className="amount-fieldset">
                    <legend>Receipt amounts in Brazilian reais</legend>
                    <div className="amount-grid">
                      <label>
                        Food subtotal
                        <span className="money-input">
                          <span>R$</span>
                          <input
                            aria-label="Food subtotal"
                            type="number"
                            min="0"
                            max="100000"
                            step="0.01"
                            inputMode="decimal"
                            value={form.subtotal}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                subtotal: event.target.value,
                              }))
                            }
                            required
                          />
                        </span>
                      </label>
                      <label>
                        Delivery fee
                        <span className="money-input">
                          <span>R$</span>
                          <input
                            aria-label="Delivery fee"
                            type="number"
                            min="0"
                            max="100000"
                            step="0.01"
                            inputMode="decimal"
                            value={form.deliveryFee}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                deliveryFee: event.target.value,
                              }))
                            }
                            required
                          />
                        </span>
                      </label>
                      <label>
                        Service fee
                        <span className="money-input">
                          <span>R$</span>
                          <input
                            aria-label="Service fee"
                            type="number"
                            min="0"
                            max="100000"
                            step="0.01"
                            inputMode="decimal"
                            value={form.serviceFee}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                serviceFee: event.target.value,
                              }))
                            }
                            required
                          />
                        </span>
                      </label>
                    </div>
                  </fieldset>

                  <div className="form-grid lower-fields">
                    <label>
                      Expected arrival <span>(optional)</span>
                      <input
                        type="datetime-local"
                        value={form.expectedAt}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            expectedAt: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Notes <span>(optional)</span>
                      <input
                        value={form.notes}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        placeholder="Apartment, contact, or receipt note"
                        maxLength={500}
                      />
                    </label>
                  </div>

                  <div className="order-summary">
                    <div>
                      <span>Expense to post</span>
                      <strong>{formatMoney(totalCents)}</strong>
                      <small>One charge · BRL · posted immediately</small>
                    </div>
                    <button
                      className="primary-button"
                      disabled={submitting || totalCents <= 0}
                    >
                      {submitting ? "Recording…" : "Record delivery & expense"}
                      {!submitting ? <span aria-hidden="true">→</span> : null}
                    </button>
                  </div>
                </form>

                <aside className="history-card" aria-labelledby="history-title">
                  <div className="section-heading compact">
                    <span className="step-number">03</span>
                    <div>
                      <h2 id="history-title">Food delivery history</h2>
                      <p>Newest receipts appear first.</p>
                    </div>
                  </div>
                  {deliveries.length ? (
                    <ol className="delivery-list">
                      {deliveries.map((delivery) => (
                        <li key={delivery.id}>
                          <div className="delivery-topline">
                            <span
                              className={
                                "provider-badge provider-" + delivery.provider
                              }
                            >
                              {providerName(delivery.provider)}
                            </span>
                            <span
                              className={"status status-" + delivery.status}
                            >
                              {statusName(delivery.status)}
                            </span>
                          </div>
                          <strong className="restaurant-name">
                            {delivery.restaurantName}
                          </strong>
                          <span className="order-number">
                            Order {delivery.providerOrderId}
                          </span>
                          <div className="delivery-address">
                            <span aria-hidden="true">⌂</span>
                            {delivery.deliveryAddress}
                          </div>
                          <div className="expense-link">
                            <ReceiptIcon />
                            <span>
                              Expense {delivery.expenseStatus}
                              <small>{delivery.expenseId.slice(0, 8)}</small>
                            </span>
                            <strong>
                              {formatMoney(
                                delivery.totalCents,
                                delivery.currency,
                              )}
                            </strong>
                          </div>
                          <div className="delivery-footer">
                            <span>{formatDate(delivery.placedAt)}</span>
                            {delivery.expectedAt ? (
                              <span>ETA {formatDate(delivery.expectedAt)}</span>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="empty-state">
                      <span>
                        <ReceiptIcon />
                      </span>
                      <strong>No food deliveries yet</strong>
                      <p>Your first recorded receipt will appear here.</p>
                    </div>
                  )}
                </aside>
              </div>
            ) : (
              <section className="state-card">
                <strong>No founder membership available</strong>
                <p>Ask a runtime administrator to add your founder profile.</p>
              </section>
            )}
          </>
        )}
      </main>

      <footer>
        This records orders placed on a shared provider account. It does not
        place an order with iFood or 99Food.
      </footer>

      <div className="announcements" aria-live="polite">
        {notice ? <p className="notice">{notice}</p> : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
