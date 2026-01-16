from arcadepy import AsyncArcade
from dotenv import load_dotenv
from google.adk import Agent, Runner
from google.adk.artifacts import InMemoryArtifactService
from google.adk.models.lite_llm import LiteLlm
from google.adk.sessions import InMemorySessionService, Session
from google_adk_arcade.tools import get_arcade_tools
from google.genai import types
from human_in_the_loop import auth_tool, confirm_tool_usage

import os

load_dotenv(override=True)


async def main():
    app_name = "my_agent"
    user_id = os.getenv("ARCADE_USER_ID")

    session_service = InMemorySessionService()
    artifact_service = InMemoryArtifactService()
    client = AsyncArcade()

    agent_tools = await get_arcade_tools(
        client, toolkits=["Stripe"]
    )

    for tool in agent_tools:
        await auth_tool(client, tool_name=tool.name, user_id=user_id)

    agent = Agent(
        model=LiteLlm(model=f"openai/{os.environ["OPENAI_MODEL"]}"),
        name="google_agent",
        instruction="# Introduction
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

This structured approach ensures that the agent can handle a variety of Stripe-related tasks efficiently and effectively.",
        description="An agent that uses Stripe tools provided to perform any task",
        tools=agent_tools,
        before_tool_callback=[confirm_tool_usage],
    )

    session = await session_service.create_session(
        app_name=app_name, user_id=user_id, state={
            "user_id": user_id,
        }
    )
    runner = Runner(
        app_name=app_name,
        agent=agent,
        artifact_service=artifact_service,
        session_service=session_service,
    )

    async def run_prompt(session: Session, new_message: str):
        content = types.Content(
            role='user', parts=[types.Part.from_text(text=new_message)]
        )
        async for event in runner.run_async(
            user_id=user_id,
            session_id=session.id,
            new_message=content,
        ):
            if event.content.parts and event.content.parts[0].text:
                print(f'** {event.author}: {event.content.parts[0].text}')

    while True:
        user_input = input("User: ")
        if user_input.lower() == "exit":
            print("Goodbye!")
            break
        await run_prompt(session, user_input)


if __name__ == '__main__':
    import asyncio
    asyncio.run(main())