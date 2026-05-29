import axios, { AxiosInstance } from "axios";
import { serviceResponse } from "../../../utils/apiResponse";

const secretKey = process.env.PAYSTACK_SECRET_KEY as string;

// ... keeping your existing interfaces intact ...
interface CreateRecipientPayload {
  name: string;
  accountNumber: string;
  bankCode: string;
  currency?: string;
}

interface InitiateTransferPayload {
  recipientCode: string;
  amount: number; // Expecting amount in KOBO
  reason?: string;
  reference: string;
}

interface VerifyBankAccountPayload {
  bankCode: string;
  accountNumber: string;
}

class PaystackService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: "https://api.paystack.co",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  async createRecipient({
    name,
    accountNumber,
    bankCode,
    currency = "NGN",
  }: CreateRecipientPayload) {
    try {
      const response = await this.api.post("/transferrecipient", {
        type: "nuban",
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency,
      });

      // Standardize return format using your serviceResponse utility
      if (response.data.status === false) {
        return serviceResponse(false, response.data.message, null);
      }

      return serviceResponse(true, "Recipient created successfully", response.data.data);
    } catch (error: any) {
      // Fixed syntax: Removed the extra closing curly brace inside string interpolation
      return serviceResponse(
        false,
        `Paystack createRecipient failed: ${
          error.response?.data?.message || error.message
        }`,
        null
      );
    }
  }

  async initiateTransfer({
    recipientCode,
    amount,
    reason = "customer withdrawal",
    reference,
  }: InitiateTransferPayload) {
    try {
      const response = await this.api.post("/transfer", {
        source: "balance",
        amount, // CRITICAL NOTE: Ensure this value is passed in KOBO (Naira * 100) from your controller
        recipient: recipientCode,
        reason,
        reference,
      });

      if (response.data.status === false) {
        return serviceResponse(false, response.data.message, null);
      }

      return serviceResponse(true, "Transfer initiated successfully", response.data.data);
    } catch (error: any) {
      // Changed from throwing an Error instance to uniform serviceResponse matching your style
      return serviceResponse(
        false,
        `Paystack initiateTransfer failed: ${
          error.response?.data?.message || error.message
        }`,
        null
      );
    }
  }

  async getBanks() {
    try {
      const response = await this.api.get("/bank");
      return serviceResponse(
        true,
        "Banks retrieved successfully",
        response.data.data
      );
    } catch (error: any) {
      return serviceResponse(
        false,
        `Paystack getBanks failed: ${
          error.response?.data?.message || error.message
        }`,
        null
      );
    }
  }

  async verifyBankAccount({
    bankCode,
    accountNumber,
  }: VerifyBankAccountPayload) {
    try {
      const response = await this.api.get("/bank/resolve", {
        params: {
          account_number: accountNumber,
          bank_code: bankCode,
        },
      });

      if (response.data.status === false) {
        return serviceResponse(false, response.data.message, null);
      }

      return serviceResponse(true, "Bank account resolved successfully", response.data.data);
    } catch (error: any) {
      // Changed from throwing an Error instance to uniform serviceResponse matching your style
      return serviceResponse(
        false,
        `Paystack verifyBankAccount failed: ${
          error.response?.data?.message || error.message
        }`,
        null
      );
    }
  }
}

export default PaystackService;
