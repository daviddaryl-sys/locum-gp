import { describe, expect, it, vi } from "vitest";

import {
  collectBackupRecords,
  decryptBackupForRecovery,
  exportEncryptedBackup,
} from "@/features/backup/exportBackup";
import { RECORD_STORES, type RecordStoreName } from "@/offline/types";

describe("encrypted backup export", () => {
  it("exports a versioned encrypted envelope with no plaintext records or tokens", async () => {
    const records = {
      practices: [{ id: "practice-1", name: "Private Practice" }],
      settings: [{ id: "settings-1", ciphertext: "already-encrypted-bank-data" }],
    };
    const envelope = await exportEncryptedBackup(
      records,
      "correct horse battery staple",
      "2026-08-02T09:00:00.000Z",
    );
    const serialized = JSON.stringify(envelope);

    expect(envelope).toMatchObject({ version: 1, cipher: "AES-GCM", kdf: "PBKDF2-SHA-256" });
    expect(serialized).not.toContain("Private Practice");
    expect(serialized).not.toContain("already-encrypted-bank-data");
    expect(serialized).not.toContain("correct horse battery staple");
    expect(serialized).not.toMatch(/access_token|refresh_token/i);
    expect(
      await decryptBackupForRecovery(envelope, "correct horse battery staple"),
    ).toEqual({ version: 1, createdAt: "2026-08-02T09:00:00.000Z", records });
  });

  it("rejects the wrong backup passphrase generically", async () => {
    const envelope = await exportEncryptedBackup(
      { practices: [] },
      "correct horse battery staple",
      "2026-08-02T09:00:00.000Z",
    );
    await expect(
      decryptBackupForRecovery(envelope, "incorrect passphrase"),
    ).rejects.toThrow("Backup could not be unlocked.");
  });

  it("collects expense and category metadata from RECORD_STORES only", async () => {
    const records = Object.fromEntries(
      RECORD_STORES.map((recordType) => [
        recordType,
        [
          {
            id: `${recordType}-1`,
            data:
              recordType === "expenses"
                ? {
                    receiptObjectKey: "owner-a/expense-1/receipt.pdf",
                    receiptOriginalName: "receipt.pdf",
                    receiptSizeBytes: 42,
                    supplierDescription: "Professional indemnity",
                  }
                : recordType === "expenseCategories"
                  ? { name: "Custom professional fee" }
                  : { label: recordType },
            updatedAt: "2026-08-02T09:00:00.000Z",
            deletedAt: null,
          },
        ],
      ]),
    ) as unknown as Record<RecordStoreName, Array<Record<string, unknown>>>;
    const tableFor = vi.fn((recordType: RecordStoreName) => ({
      where: vi.fn(() => ({
        equals: vi.fn(() => ({ toArray: vi.fn(async () => records[recordType]) })),
      })),
    }));

    const backup = await collectBackupRecords({
      ownerId: "owner-a",
      tableFor,
    } as never);

    expect(Object.keys(backup)).toEqual(RECORD_STORES);
    expect(backup.expenseCategories).toEqual([
      {
        id: "expenseCategories-1",
        data: { name: "Custom professional fee" },
        updatedAt: "2026-08-02T09:00:00.000Z",
        deletedAt: null,
      },
    ]);
    expect(backup.expenses).toEqual([
      {
        id: "expenses-1",
        data: {
          receiptObjectKey: "owner-a/expense-1/receipt.pdf",
          receiptOriginalName: "receipt.pdf",
          receiptSizeBytes: 42,
          supplierDescription: "Professional indemnity",
        },
        updatedAt: "2026-08-02T09:00:00.000Z",
        deletedAt: null,
      },
    ]);
    expect(tableFor).toHaveBeenCalledTimes(RECORD_STORES.length);
    expect(tableFor).not.toHaveBeenCalledWith("receiptQueue");
  });

  it("excludes queued receipt blobs, signed URLs, file bytes, and tokens", async () => {
    const envelope = await exportEncryptedBackup(
      {
        expenses: [
          {
            supplierDescription: "Professional indemnity",
            receiptObjectKey: "owner-a/expense-1/receipt.pdf",
            receiptOriginalName: "receipt.pdf",
            receiptSizeBytes: 42,
            signedUrl: "https://storage.example.test/signed/private-receipt",
            receiptFileBytes: new Uint8Array([1, 2, 3]),
            access_token: "never-back-this-up",
          },
        ],
        expenseCategories: [{ name: "Custom professional fee" }],
        receiptQueue: [
          {
            blob: new Blob(["private receipt file bytes"], { type: "application/pdf" }),
            signedUrl: "https://storage.example.test/signed/queued-receipt",
          },
        ],
      },
      "correct horse battery staple",
      "2026-08-02T09:00:00.000Z",
    );

    const recovered = await decryptBackupForRecovery(
      envelope,
      "correct horse battery staple",
    );
    const serialized = JSON.stringify(recovered);

    expect(recovered.records).toEqual({
      expenses: [
        {
          supplierDescription: "Professional indemnity",
          receiptObjectKey: "owner-a/expense-1/receipt.pdf",
          receiptOriginalName: "receipt.pdf",
          receiptSizeBytes: 42,
        },
      ],
      expenseCategories: [{ name: "Custom professional fee" }],
    });
    expect(serialized).not.toContain("private receipt file bytes");
    expect(serialized).not.toContain("signed/private-receipt");
    expect(serialized).not.toMatch(/token|receiptFileBytes|receiptQueue/i);
  });

  it("excludes canonical secret keys and encoded binary receipt values", async () => {
    const envelope = await exportEncryptedBackup(
      {
        expenses: [
          {
            supplierDescription: "Professional indemnity",
            accessToken: "fictional-access-token",
            auth_token: "fictional-auth-token",
            id_token: "fictional-id-token",
            receiptBase64: "ZmljdGlvbmFsIHJlY2VpcHQ=",
            token: "fictional-token",
            receiptContent: "fictional receipt content",
            signedUri: "https://storage.example.test/signed/receipt",
            receiptSignedUrl: "https://storage.example.test/signed/receipt",
            signedReceiptUrl: "https://storage.example.test/signed/receipt",
            sessionToken: "fictional-session-token",
            receiptBytes: "ZmljdGlvbmFsIHJlY2VpcHQ=",
            receipt_bytes: [1, 2, 3],
            receiptOriginalName: "fictional-receipt.pdf",
            unexpectedDataUri: "data:application/pdf;base64,ZmljdGlvbmFsIHJlY2VpcHQ=",
            unexpectedByteArray: [4, 5, 6],
            unexpectedNestedByteMatrix: [[7, 8], [9, 10]],
          },
        ],
      },
      "correct horse battery staple",
      "2026-08-02T09:00:00.000Z",
    );

    const recovered = await decryptBackupForRecovery(
      envelope,
      "correct horse battery staple",
    );

    expect(recovered.records).toEqual({
      expenses: [{
        receiptOriginalName: "fictional-receipt.pdf",
        supplierDescription: "Professional indemnity",
      }],
    });
  });
});
