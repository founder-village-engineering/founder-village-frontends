import { useMemo, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { Empty, Field, Notice, RequestFeedback } from "./feature-ui";
import {
  foodDeliveryInputSchema,
  type FoodDelivery,
  type FoodDeliveryInput,
} from "./generated/contracts/food-deliveries";
import { useResource, useWrite } from "./requests";
import { styles } from "./theme";
import { Button, ErrorMessage } from "./ui";
import type { WorkspaceApi } from "./workspace-api";

const names = { ifood: "iFood", "99food": "99Food" } as const;
const statusNames: Record<FoodDelivery["status"], string> = {
  placed: "Placed",
  accepted: "Accepted",
  preparing: "Preparing",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const newForm = () => ({
  order: "",
  restaurant: "",
  address: "",
  subtotal: "",
  deliveryFee: "",
  serviceFee: "",
  eta: "",
  notes: "",
});
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function money(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(
    cents / 100,
  );
}

function cents(value: string) {
  const input = value.trim();
  if (!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(input)) return NaN;
  const [whole, fraction = ""] = input.split(/[.,]/);
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function expectedTime(value: string) {
  if (!value.trim()) return undefined;
  const input = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null;
  const parsed = new Date(input);
  if (Number.isNaN(+parsed)) return null;
  const roundTrip = new Date(+parsed - parsed.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  return input === roundTrip ? parsed.toISOString() : null;
}

export default function Deliveries({
  client,
  tenantId,
}: {
  client: WorkspaceApi;
  tenantId: string;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const api = useMemo(() => client.deliveries(tenantId), [client, tenantId]);
  const orders = useResource(
    api.orders,
    "Could not load deliveries. Try again.",
  );
  const profile = useResource(
    api.profile,
    "Could not load your workspace balance.",
  );
  const write = useWrite("Could not log this delivery. Try again.");
  const [provider, setProvider] =
    useState<FoodDeliveryInput["provider"]>("ifood");
  const [form, setForm] = useState(newForm);
  const [invalid, setInvalid] = useState("");
  const [saved, setSaved] = useState(false);
  const subtotal = cents(form.subtotal);
  const deliveryFee = cents(form.deliveryFee || "0");
  const serviceFee = cents(form.serviceFee || "0");
  const total = subtotal + deliveryFee + serviceFee;
  const field = (name: keyof typeof form) => ({
    value: form[name],
    onChangeText: (value: string) =>
      setForm((current) => ({ ...current, [name]: value })),
    editable: !write.busy,
  });

  async function create() {
    setSaved(false);
    setInvalid("");
    const total = subtotal + deliveryFee + serviceFee;
    if (!Number.isFinite(total) || total <= 0 || total > 10_000_000) {
      setInvalid(
        "Enter the subtotal and any fees in BRL, with up to two decimal places.",
      );
      return;
    }
    const eta = expectedTime(form.eta);
    if (eta === null) {
      setInvalid(
        "Enter the expected time as YYYY-MM-DD HH:MM in your local time.",
      );
      return;
    }
    const input = foodDeliveryInputSchema.safeParse({
      provider,
      providerOrderId: form.order,
      restaurantName: form.restaurant,
      deliveryAddress: form.address,
      subtotalCents: subtotal,
      deliveryFeeCents: deliveryFee,
      serviceFeeCents: serviceFee,
      ...(eta ? { expectedAt: eta } : {}),
      ...(form.notes.trim() ? { notes: form.notes } : {}),
    });
    if (!input.success) {
      setInvalid(
        "Enter the provider order ID, restaurant, and delivery address.",
      );
      return;
    }
    const order = await write.run(input.data, (key) =>
      api.create(input.data, key),
    );
    if (order) {
      setForm({ ...newForm(), address: form.address });
      setSaved(true);
      orders.retry();
      profile.retry();
    }
  }

  return (
    <View style={[styles.featureSplit, wide && styles.featureSplitWide]}>
      <View
        style={[
          styles.featureColumn,
          wide && [styles.featureColumnWide, styles.formColumnWide],
        ]}
      >
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.subheading}>
            Log an order
          </Text>
          <Text style={styles.text}>
            After ordering in iFood or 99Food, save the delivery and its expense
            here.
          </Text>
          <View style={styles.wrapRow}>
            {(Object.keys(names) as (keyof typeof names)[]).map((id) => (
              <Button
                key={id}
                label={names[id]}
                variant={id === provider ? "primary" : "secondary"}
                selected={id === provider}
                disabled={write.busy}
                onPress={() => setProvider(id)}
              />
            ))}
          </View>
          <Field
            label="Provider order ID"
            {...field("order")}
            maxLength={80}
            autoCapitalize="none"
          />
          <Field label="Restaurant" {...field("restaurant")} maxLength={160} />
          <Field
            label="Delivery address"
            {...field("address")}
            maxLength={240}
          />
          <Field
            label="Subtotal (BRL)"
            {...field("subtotal")}
            keyboardType="decimal-pad"
            maxLength={9}
          />
          <Field
            label="Delivery fee (BRL)"
            {...field("deliveryFee")}
            keyboardType="decimal-pad"
            placeholder="0,00"
            maxLength={9}
          />
          <Field
            label="Service fee (BRL)"
            {...field("serviceFee")}
            keyboardType="decimal-pad"
            placeholder="0,00"
            maxLength={9}
          />
          <Field
            label="Expected time (optional)"
            {...field("eta")}
            placeholder="YYYY-MM-DD HH:MM"
            maxLength={16}
          />
          <Field
            label="Delivery notes (optional)"
            {...field("notes")}
            maxLength={500}
            multiline
          />
          <ErrorMessage message={invalid || write.error} />
          {saved && <Notice>Delivery and expense saved.</Notice>}
          {Number.isFinite(total) && (
            <Text style={styles.sectionLabel}>Total {money(total)}</Text>
          )}
          <Button
            label="Log delivery"
            busy={write.busy}
            onPress={() => void create()}
          />
        </View>
      </View>
      <View style={[styles.featureColumn, wide && styles.featureColumnWide]}>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.subheading}>
            Workspace balance
          </Text>
          <RequestFeedback state={profile} loading="Loading balance…" />
          {profile.status === "ready" && (
            <>
              <Text style={styles.sectionLabel}>
                {money(
                  profile.data.balance.balanceCents,
                  profile.data.balance.currency,
                )}
              </Text>
              <Text style={styles.label}>{profile.data.fullName}</Text>
              {profile.data.room && (
                <Text style={styles.text}>{profile.data.room}</Text>
              )}
              {profile.data.companies.map((company) => (
                <Text key={company.id} style={styles.text}>
                  {company.name}
                </Text>
              ))}
            </>
          )}
        </View>
        <Text accessibilityRole="header" style={styles.subheading}>
          Delivery history
        </Text>
        <RequestFeedback state={orders} loading="Loading deliveries…" />
        {orders.status === "ready" &&
          (orders.data.length ? (
            orders.data.map((order) => (
              <Delivery key={order.id} order={order} />
            ))
          ) : (
            <Empty>No deliveries have been logged yet.</Empty>
          ))}
      </View>
    </View>
  );
}

function Delivery({ order }: { order: FoodDelivery }) {
  return (
    <View style={styles.card}>
      <Text style={styles.available}>{statusNames[order.status]}</Text>
      <Text style={styles.subheading}>{order.restaurantName}</Text>
      <Text style={styles.text}>
        {names[order.provider]} · {order.providerOrderId}
      </Text>
      <Text style={styles.text}>{order.deliveryAddress}</Text>
      <Text style={styles.text}>
        {dateFormat.format(new Date(order.placedAt))}
      </Text>
      {order.expectedAt && (
        <Text style={styles.text}>
          Expected {dateFormat.format(new Date(order.expectedAt))}
        </Text>
      )}
      {Boolean(order.notes) && <Text style={styles.text}>{order.notes}</Text>}
      <Text style={styles.label}>
        {money(order.totalCents, order.currency)} · Expense{" "}
        {order.expenseStatus}
      </Text>
    </View>
  );
}
