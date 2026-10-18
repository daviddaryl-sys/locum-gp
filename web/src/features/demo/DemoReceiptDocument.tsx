import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export const DEMO_RECEIPT_HEADING = "DEMO — NOT A REAL RECEIPT";

const styles = StyleSheet.create({
  body: { padding: 40, fontFamily: "Helvetica", fontSize: 12 },
  heading: { fontSize: 18, marginBottom: 24 },
  row: { marginBottom: 10 },
});

export function DemoReceiptDocument({ amountPence, date, reference }: { amountPence: number; date: string; reference: string }) {
  return <Document><Page size="A4" style={styles.body}>
    <Text style={styles.heading}>{DEMO_RECEIPT_HEADING}</Text>
    <View style={styles.row}><Text>Reference: {reference}</Text></View>
    <View style={styles.row}><Text>Date: {date}</Text></View>
    <View style={styles.row}><Text>Fictional amount: £{(amountPence / 100).toFixed(2)}</Text></View>
    <Text>This generated document is demo data only and is not evidence of a purchase.</Text>
  </Page></Document>;
}

export async function renderDemoReceiptPdf(props: React.ComponentProps<typeof DemoReceiptDocument>) {
  return renderToBuffer(<DemoReceiptDocument {...props} />);
}
