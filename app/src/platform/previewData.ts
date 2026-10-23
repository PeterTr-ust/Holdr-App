/**
 * Sample portfolio for the browser preview. Never used in the desktop app.
 */
import type { PortfolioRepository } from "../data/repository";

export async function seedPreviewData(repository: PortfolioRepository): Promise<void> {
  const world = await repository.upsertInstrument({
    symbol: "EUNL.DE",
    name: "iShares Core MSCI World UCITS ETF",
    currency: "EUR",
    exchange: "XETRA",
    kind: "ETF",
  });
  const sap = await repository.upsertInstrument({
    symbol: "SAP.DE",
    name: "SAP SE",
    currency: "EUR",
    exchange: "XETRA",
    kind: "EQUITY",
  });
  const apple = await repository.upsertInstrument({
    symbol: "AAPL",
    name: "Apple Inc.",
    currency: "USD",
    exchange: "NASDAQ",
    kind: "EQUITY",
  });
  const siemens = await repository.upsertInstrument({
    symbol: "SIE.DE",
    name: "Siemens AG",
    currency: "EUR",
    exchange: "XETRA",
    kind: "EQUITY",
  });

  const trade = (
    instrumentId: number,
    type: "BUY" | "SELL",
    date: string,
    quantity: number,
    price: number,
    fee = 1,
  ) =>
    repository.createTransaction({
      instrumentId,
      type,
      date,
      quantity,
      price,
      fee,
      tax: 0,
      note: null,
    });

  await trade(world.id, "BUY", daysAgo(700), 120, 72.4);
  await trade(world.id, "BUY", daysAgo(400), 100, 86.3);
  await trade(sap.id, "BUY", daysAgo(650), 50, 118.4);
  await trade(sap.id, "SELL", daysAgo(120), 15, 232.0);
  await trade(apple.id, "BUY", daysAgo(500), 40, 160.2);
  await trade(siemens.id, "BUY", daysAgo(300), 20, 185.0);
  await repository.createTransaction({
    instrumentId: sap.id,
    type: "DIVIDEND",
    date: daysAgo(160),
    amount: 77,
    fee: 0,
    tax: 20.31,
    note: null,
  });
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}
