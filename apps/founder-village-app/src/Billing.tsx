import { useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { actionError } from "./api";
import {
  signatureSchema,
  type CheckoutResponse,
  type PaymentMethod,
} from "./generated/contracts/features/founder-village-members/index";
import {
  formatAmount,
  methodNames,
  useMembership,
  type BillingProps,
} from "./membership";
import { newRequestKey, openExternal } from "./session";
import { styles } from "./theme";
import { Button, ErrorMessage, Loading } from "./ui";

function PayQr({ url }: { url: string }) {
  const [data, setData] = useState("");
  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then(({ default: qr }) => qr.toDataURL(url, { width: 256, margin: 3 }))
      .then((image) => {
        if (active) setData(image);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [url]);
  return data ? (
    <Image
      source={{ uri: data }}
      style={styles.qr}
      accessibilityLabel="Solana Pay QR code"
    />
  ) : null;
}

export default function Billing({ api, compact, returning }: BillingProps) {
  const { membership, error, reload } = useMembership(api);
  const [checkout, setCheckout] = useState<CheckoutResponse>();
  const [busy, setBusy] = useState(false);
  const [actionProblem, setProblem] = useState("");
  const [updated, setUpdated] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [signature, setSignature] = useState("");
  const [deadlineReached, setDeadlineReached] = useState(false);
  const keys = useRef<Partial<Record<PaymentMethod, string>>>({});
  const sawReturn = useRef(false);
  const pending =
    membership?.checkout?.status === "pending"
      ? membership.checkout
      : undefined;
  const settled = membership?.tier === "paid";
  const quoteClosed =
    !!pending &&
    (deadlineReached || Date.parse(pending.expiresAt) <= Date.now());
  const cryptoAction =
    pending &&
    !quoteClosed &&
    checkout?.checkout.id === pending.id &&
    checkout.action?.kind === "solana"
      ? checkout.action
      : undefined;

  useEffect(() => {
    setDeadlineReached(false);
    if (!pending?.expiresAt) return;
    const timer = setTimeout(
      () => setDeadlineReached(true),
      Math.max(0, Date.parse(pending.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pending?.expiresAt]);

  useEffect(() => {
    if (!pending || settled) return;
    const poll = setInterval(() => {
      void reload();
    }, 6000);
    return () => clearInterval(poll);
  }, [pending?.id, settled, reload]);

  useEffect(() => {
    if (
      !returning ||
      !pending ||
      pending.method !== "card" ||
      sawReturn.current
    )
      return;
    sawReturn.current = true;
    void api
      .check(pending.id)
      .then(reload)
      .catch((failure: unknown) =>
        setProblem(
          actionError(
            failure,
            "Payment is still being checked. Refresh in a moment.",
          ),
        ),
      );
  }, [api, pending, reload, returning]);

  async function run(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setProblem("");
    setUpdated(false);
    try {
      await operation();
    } catch (error) {
      setProblem(
        actionError(
          error,
          "Could not complete the payment request. Try again.",
        ),
      );
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function nextPayment(result: CheckoutResponse) {
    setCheckout(result);
    if (result.action?.kind === "stripe") {
      await openExternal(result.action.url);
      return;
    }
    await reload();
  }

  function start(method: PaymentMethod) {
    void run(async () => {
      const key = (keys.current[method] ??= newRequestKey());
      const result = await api.start(method, key);
      delete keys.current[method];
      await nextPayment(result);
    });
  }

  function check(id: string, transaction?: string) {
    void run(async () => {
      const result = await api.check(id, transaction);
      await reload();
      if (transaction && result.status !== "paid") {
        setProblem("No finalized payment matched that signature and checkout.");
      } else if (result.status === "pending") setUpdated(true);
    });
  }

  function submitSignature(id: string) {
    const result = signatureSchema.safeParse(signature.trim());
    if (!result.success) {
      setProblem(
        "Enter the transaction signature shown in your Solana wallet.",
      );
      return;
    }
    check(id, result.data);
  }

  const last = membership?.checkout;
  const canSubmitSignature =
    last &&
    last.method !== "card" &&
    (last.status === "pending" || last.status === "expired");

  return (
    <ScrollView
      style={styles.scroll}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.wrap,
        styles.folder,
        compact && styles.compactWrap,
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.heading, !compact && styles.headingWide]}
      >
        Membership
      </Text>
      {!membership && !error && <Loading>Loading your membership…</Loading>}
      <ErrorMessage message={error} />
      {error !== "" && (
        <Button
          label="Retry"
          variant="secondary"
          onPress={() => void reload()}
        />
      )}
      {membership && (
        <>
          <View style={styles.statusCard}>
            <Text style={styles.available}>
              {settled ? "Premium member" : "Free member"}
            </Text>
            <Text style={styles.text}>
              {settled
                ? "Your upgrade is active."
                : "You can browse the directory and message members who share their WhatsApp number."}
            </Text>
            {settled && last && (
              <Text style={styles.small}>
                {formatAmount(last)} · {methodNames[last.method]}
                {last.test ? " · Test payment" : ""}
              </Text>
            )}
          </View>
          {!settled && (
            <View style={[styles.card, !compact && styles.cardWide]}>
              <Text accessibilityRole="header" style={styles.subheading}>
                {pending ? "Payment in progress" : "Upgrade to premium"}
              </Text>
              <ErrorMessage message={actionProblem} />
              {pending ? (
                <>
                  <Text style={styles.text}>
                    {formatAmount(pending)} · {methodNames[pending.method]}
                    {pending.test ? " · Test mode" : ""}
                  </Text>
                  <Text style={styles.small}>
                    Quote expires {new Date(pending.expiresAt).toLocaleString()}
                    .
                  </Text>
                  {quoteClosed ? (
                    <Text style={styles.text}>
                      This quote has closed. We’re checking for any payment sent
                      before it expired.
                    </Text>
                  ) : cryptoAction ? (
                    <>
                      <PayQr key={cryptoAction.url} url={cryptoAction.url} />
                      <Text style={styles.text}>
                        Scan with a Solana Pay wallet, or open your wallet on
                        this device. Pay this request only once, before it
                        expires.{" "}
                        {cryptoAction.network === "devnet"
                          ? "Use Solana Devnet for this test."
                          : "Use Solana mainnet."}
                      </Text>
                      <Button
                        label="Open Solana wallet"
                        onPress={() =>
                          void run(async () => {
                            if (Date.now() >= Date.parse(pending.expiresAt))
                              setDeadlineReached(true);
                            else await openExternal(cryptoAction.url);
                          })
                        }
                        disabled={busy}
                      />
                    </>
                  ) : (
                    <Button
                      label={
                        pending.method === "card"
                          ? "Continue to Stripe Checkout"
                          : "Show Solana Pay request"
                      }
                      onPress={() =>
                        void run(async () => {
                          await nextPayment(await api.open(pending.id));
                        })
                      }
                      disabled={busy}
                    />
                  )}
                  <View style={styles.wrapRow}>
                    <Button
                      variant="secondary"
                      label="Check payment status"
                      onPress={() => check(pending.id)}
                      busy={busy}
                    />
                    {pending.method === "card" && (
                      <Button
                        variant="quiet"
                        label="Cancel checkout"
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            await api.cancel(pending.id);
                            await reload();
                          })
                        }
                      />
                    )}
                  </View>
                  {updated && (
                    <Text accessibilityLiveRegion="polite" style={styles.small}>
                      Still awaiting payment confirmation.
                    </Text>
                  )}
                </>
              ) : (
                <>
                  {last?.status === "expired" && (
                    <Text style={styles.text}>
                      The previous payment request expired.
                    </Text>
                  )}
                  {last?.status === "reversed" && (
                    <Text style={styles.text}>
                      Your previous payment was refunded or disputed.
                    </Text>
                  )}
                  {membership.offers.length ? (
                    <>
                      <Text style={styles.text}>
                        One-time payment. Choose how you’d like to pay.
                      </Text>
                      {membership.offers.map((offer) => (
                        <Pressable
                          key={offer.method}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: busy }}
                          disabled={busy}
                          onPress={() => start(offer.method)}
                          style={({ pressed }) => [
                            styles.option,
                            pressed && styles.pressed,
                            busy && styles.disabled,
                          ]}
                        >
                          <Text style={styles.optionLabel}>
                            {methodNames[offer.method]}
                          </Text>
                          <Text style={styles.small}>
                            {formatAmount(offer)}
                            {offer.test ? " · Test mode" : ""}
                          </Text>
                        </Pressable>
                      ))}
                      {membership.offers.some(
                        ({ method }) => method === "card",
                      ) && (
                        <Text style={styles.small}>
                          Apple Pay appears in Stripe Checkout on eligible
                          devices.
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text style={styles.text}>
                      Premium upgrades are currently unavailable.
                    </Text>
                  )}
                </>
              )}
              {canSubmitSignature && (
                <>
                  <Button
                    label={
                      showSignature
                        ? "Hide transaction lookup"
                        : "Find my Solana payment"
                    }
                    variant="quiet"
                    onPress={() => setShowSignature((value) => !value)}
                    disabled={busy}
                  />
                  {showSignature && (
                    <View style={styles.inputWrap}>
                      <Text style={styles.label}>
                        Solana transaction signature
                      </Text>
                      <TextInput
                        accessibilityLabel="Solana transaction signature"
                        maxLength={88}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={styles.input}
                        value={signature}
                        onChangeText={setSignature}
                      />
                      <Button
                        label="Verify transaction"
                        variant="secondary"
                        onPress={() => submitSignature(last.id)}
                        busy={busy}
                      />
                    </View>
                  )}
                </>
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
