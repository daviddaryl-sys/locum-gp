import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import { formatGBP } from "@/domain/money";

export type InvoicePdfItem = {
  description: string;
  quantity: number;
  unitRatePence: number;
  lineTotalPence: number;
};

export type InvoicePdfData = {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  issuer: {
    name: string;
    address: string;
  };
  practice: {
    name: string;
    billingAddress: string;
  };
  payment: {
    accountName: string;
    sortCode: string;
    accountNumber: string;
  };
  items: InvoicePdfItem[];
  totalPence: number;
};

const styles = StyleSheet.create({
  page: {
    padding: 46,
    color: "#173126",
    backgroundColor: "#ffffff",
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.45,
  },
  header: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 24,
    borderBottomWidth: 2,
    borderBottomColor: "#2f6f55",
  },
  brand: { color: "#2f6f55", fontSize: 10, fontWeight: 700 },
  title: { marginTop: 4, fontSize: 26, fontWeight: 700 },
  number: { marginTop: 4, color: "#475467", fontSize: 11 },
  meta: { width: 190, display: "flex", gap: 6 },
  metaRow: { display: "flex", flexDirection: "row", justifyContent: "space-between" },
  metaLabel: { color: "#667085" },
  addresses: { display: "flex", flexDirection: "row", gap: 34, marginTop: 28 },
  address: { width: "50%" },
  sectionLabel: {
    marginBottom: 7,
    color: "#2f6f55",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  addressName: { marginBottom: 3, fontSize: 12, fontWeight: 700 },
  table: { marginTop: 30, borderWidth: 1, borderColor: "#d0d5dd" },
  tableHeader: {
    display: "flex",
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 10,
    color: "#344054",
    backgroundColor: "#f2f4f7",
    fontSize: 8,
    fontWeight: 700,
  },
  tableRow: {
    display: "flex",
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: "#eaecf0",
  },
  description: { width: "48%" },
  quantity: { width: "15%", textAlign: "right" },
  rate: { width: "18%", textAlign: "right" },
  amount: { width: "19%", textAlign: "right" },
  totalRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 26,
    marginTop: 18,
    fontSize: 14,
    fontWeight: 700,
  },
  payment: {
    marginTop: 34,
    padding: 16,
    backgroundColor: "#e8f2e9",
  },
  paymentGrid: { display: "flex", flexDirection: "row", gap: 30, marginTop: 8 },
  paymentItem: { display: "flex", gap: 2 },
  paymentLabel: { color: "#667085", fontSize: 8 },
  paymentValue: { fontWeight: 700 },
  footer: {
    position: "absolute",
    right: 46,
    bottom: 30,
    left: 46,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#eaecf0",
    color: "#667085",
    fontSize: 8,
    textAlign: "center",
  },
});

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invoice date is invalid.");
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatQuantity(value: number) {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

export function invoiceTextContent(data: InvoicePdfData) {
  return [
    "Invoice",
    data.invoiceNumber,
    formatDate(data.issueDate),
    formatDate(data.dueDate),
    data.issuer.name,
    data.issuer.address,
    data.practice.name,
    data.practice.billingAddress,
    ...data.items.flatMap((item) => [
      item.description,
      formatQuantity(item.quantity),
      formatGBP(item.unitRatePence),
      formatGBP(item.lineTotalPence),
    ]),
    formatGBP(data.totalPence),
    data.payment.accountName,
    data.payment.sortCode,
    data.payment.accountNumber,
  ];
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author={data.issuer.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>LOCUM MANAGER</Text>
            <Text style={styles.title}>Invoice</Text>
            <Text style={styles.number}>{data.invoiceNumber}</Text>
          </View>
          <View style={styles.meta}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Issue date</Text>
              <Text>{formatDate(data.issueDate)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Due date</Text>
              <Text>{formatDate(data.dueDate)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.addresses}>
          <View style={styles.address}>
            <Text style={styles.sectionLabel}>From</Text>
            <Text style={styles.addressName}>{data.issuer.name}</Text>
            <Text>{data.issuer.address}</Text>
          </View>
          <View style={styles.address}>
            <Text style={styles.sectionLabel}>Bill to</Text>
            <Text style={styles.addressName}>{data.practice.name}</Text>
            <Text>{data.practice.billingAddress}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.description}>Description</Text>
            <Text style={styles.quantity}>Quantity</Text>
            <Text style={styles.rate}>Rate</Text>
            <Text style={styles.amount}>Amount</Text>
          </View>
          {data.items.map((item, index) => (
            <View key={`${item.description}-${index}`} style={styles.tableRow} wrap={false}>
              <Text style={styles.description}>{item.description}</Text>
              <Text style={styles.quantity}>{formatQuantity(item.quantity)}</Text>
              <Text style={styles.rate}>{formatGBP(item.unitRatePence)}</Text>
              <Text style={styles.amount}>{formatGBP(item.lineTotalPence)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text>Total</Text>
          <Text>{formatGBP(data.totalPence)}</Text>
        </View>

        <View style={styles.payment}>
          <Text style={styles.sectionLabel}>Payment by bank transfer</Text>
          <Text>Please use the invoice number as the payment reference.</Text>
          <View style={styles.paymentGrid}>
            <View style={styles.paymentItem}>
              <Text style={styles.paymentLabel}>Account name</Text>
              <Text style={styles.paymentValue}>{data.payment.accountName}</Text>
            </View>
            <View style={styles.paymentItem}>
              <Text style={styles.paymentLabel}>Sort code</Text>
              <Text style={styles.paymentValue}>{data.payment.sortCode}</Text>
            </View>
            <View style={styles.paymentItem}>
              <Text style={styles.paymentLabel}>Account number</Text>
              <Text style={styles.paymentValue}>{data.payment.accountNumber}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.footer}>Generated securely by Locum Manager</Text>
      </Page>
    </Document>
  );
}
