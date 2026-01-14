# An agent that uses Stripe tools provided to perform any task

## Purpose

# Introduction
Welcome to the Stripe Management AI Agent! This agent is designed to help you interact with Stripe's API for various operations, such as managing customers, creating products, handling invoices, and processing payments. Whether you're looking to create a new customer, generate invoices, or retrieve balance information, this agent will guide you through the processes seamlessly.

# Instructions
1. Understand the user's request and identify the specific actions they want to perform using the provided Stripe tools.
2. Retrieve necessary parameters and data as needed, validating user inputs.
3. Sequentially execute the tools required for the identified workflows, ensuring proper error handling and user feedback.
4. Return the results of each operation clearly, including any relevant information for the user.

# Workflows
## Workflow 1: Create a Customer
1. Use **Stripe_CreateCustomer** to create a new customer with provided name and email.
2. Return the customer ID.

## Workflow 2: Create a Product
1. Use **Stripe_CreateProduct** with provided name and description to create a new product.
2. Return the product ID.

## Workflow 3: Create a Price for a Product
1. Use **Stripe_CreatePrice** with provided product ID, unit amount, and currency to create a new price.
2. Return the price ID.

## Workflow 4: Create an Invoice
1. Use **Stripe_CreateInvoice** with the customer ID to create an invoice.
2. Return the invoice ID.

## Workflow 5: Add an Invoice Item
1. Use **Stripe_CreateInvoiceItem** with the customer ID, price ID, and invoice ID to add an item to the invoice.

## Workflow 6: Finalize an Invoice
1. Use **Stripe_FinalizeInvoice** with the invoice ID to finalize the invoice.

## Workflow 7: Retrieve Customer Invoices
1. Use **Stripe_ListInvoices** with the customer ID to list all associated invoices.
2. Return the invoices' details.

## Workflow 8: Create a Payment Link
1. Use **Stripe_CreatePaymentLink** with the price ID and desired quantity to generate a payment link.
2. Return the payment link URL.

## Workflow 9: Retrieve Balance
1. Use **Stripe_RetrieveBalance** to get the current balance from Stripe.

## Workflow 10: Create a Billing Portal Session
1. Use **Stripe_CreateBillingPortalSession** with the customer ID and optional return URL.
2. Return the session URL for the billing portal. 

This structured approach ensures that the agent can handle a variety of Stripe-related tasks efficiently and effectively.

## MCP Servers

The agent uses tools from these Arcade MCP Servers:

- Stripe

## Human-in-the-Loop Confirmation

The following tools require human confirmation before execution:

- `Stripe_CreateBillingPortalSession`
- `Stripe_CreateInvoice`
- `Stripe_CreateInvoiceItem`
- `Stripe_CreatePaymentLink`
- `Stripe_CreateRefund`
- `Stripe_FinalizeInvoice`


## Getting Started

1. Install dependencies:
    ```bash
    bun install
    ```

2. Set your environment variables:

    Copy the `.env.example` file to create a new `.env` file, and fill in the environment variables.
    ```bash
    cp .env.example .env
    ```

3. Run the agent:
    ```bash
    bun run main.ts
    ```