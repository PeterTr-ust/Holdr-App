//! Requests to Yahoo Finance's quote summary endpoint (company profile,
//! fund sector weights, upcoming dividend and earnings dates).
//!
//! Unlike the chart and search endpoints, the quote summary needs a session
//! cookie and a matching "crumb" token. Both are fetched on first use and kept
//! in memory only: no Yahoo cookie is written to disk, and the cookie is sent
//! to Yahoo only. Only the symbol and the names of the requested modules leave
//! the computer. The response is passed to the frontend unparsed, where
//! `src/market/yahoo.ts` interprets it.

use reqwest::{Client, StatusCode};
use tauri::async_runtime::Mutex;

/// Yahoo rejects requests without a browser-like user agent.
const USER_AGENT: &str = "Mozilla/5.0 (compatible; Holdr)";
/// Answers with an error page, but sets the session cookie.
const COOKIE_URL: &str = "https://fc.yahoo.com/";
const CRUMB_URL: &str = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const SUMMARY_URL: &str = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/";

pub struct YahooSession {
    client: Client,
    crumb: Mutex<Option<String>>,
}

impl YahooSession {
    pub fn new() -> Self {
        let client = Client::builder()
            .cookie_store(true)
            .user_agent(USER_AGENT)
            .build()
            .expect("HTTP client could not be created");
        Self {
            client,
            crumb: Mutex::new(None),
        }
    }

    /// Returns the cached crumb, or starts a new session to get one.
    async fn crumb(&self, renew: bool) -> Result<String, String> {
        let mut crumb = self.crumb.lock().await;
        if renew {
            *crumb = None;
        }
        if let Some(value) = crumb.as_ref() {
            return Ok(value.clone());
        }

        // Only the cookie matters; the status of this response does not.
        let _ = self.client.get(COOKIE_URL).send().await;
        let text = self
            .client
            .get(CRUMB_URL)
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|error| format!("Yahoo session could not be started: {error}"))?
            .text()
            .await
            .map_err(|error| error.to_string())?;

        let value = text.trim();
        if !is_valid_crumb(value) {
            return Err("Yahoo did not return a session token.".into());
        }
        *crumb = Some(value.to_string());
        Ok(value.to_string())
    }
}

/// Loads the given quote summary modules for a symbol and returns the JSON text.
#[tauri::command]
pub async fn yahoo_quote_summary(
    session: tauri::State<'_, YahooSession>,
    symbol: String,
    modules: Vec<String>,
) -> Result<String, String> {
    if !is_valid_symbol(&symbol) {
        return Err("Invalid symbol.".into());
    }
    if modules.is_empty() || modules.len() > 10 || !modules.iter().all(|m| is_valid_module(m)) {
        return Err("Invalid modules.".into());
    }

    // A rejected crumb usually means the session expired: renew it once.
    for renew in [false, true] {
        let crumb = session.crumb(renew).await?;
        let response = session
            .client
            .get(format!("{SUMMARY_URL}{symbol}"))
            .query(&[("modules", modules.join(",")), ("crumb", crumb)])
            .send()
            .await
            .map_err(|error| format!("Yahoo is not reachable: {error}"))?;

        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN if !renew => continue,
            status if !status.is_success() => {
                return Err(format!("Yahoo answered with status {status}."))
            }
            _ => return response.text().await.map_err(|error| error.to_string()),
        }
    }
    Err("Yahoo rejected the session.".into())
}

/// Ticker symbols such as `SAP.DE`, `BRK-B`, `^GDAXI` or `EURUSD=X`.
fn is_valid_symbol(symbol: &str) -> bool {
    (1..=32).contains(&symbol.len())
        && symbol
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '^' | '=' | '_'))
}

/// Module names such as `assetProfile` or `calendarEvents`.
fn is_valid_module(module: &str) -> bool {
    (1..=40).contains(&module.len()) && module.chars().all(|c| c.is_ascii_alphabetic())
}

/// A crumb is a short token; anything else is an error or consent page.
fn is_valid_crumb(crumb: &str) -> bool {
    (1..=64).contains(&crumb.len()) && !crumb.contains(|c: char| c.is_whitespace() || c == '<')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ticker_symbols_only() {
        for symbol in ["SAP.DE", "BRK-B", "^GDAXI", "EURUSD=X", "AAPL"] {
            assert!(is_valid_symbol(symbol), "{symbol}");
        }
        for symbol in ["", "SAP/../x", "A?modules=x", "A B", &"A".repeat(33)] {
            assert!(!is_valid_symbol(symbol), "{symbol}");
        }
    }

    #[test]
    fn accepts_module_names_only() {
        assert!(is_valid_module("calendarEvents"));
        assert!(!is_valid_module("calendar,events"));
        assert!(!is_valid_module(""));
    }

    #[test]
    fn rejects_html_as_crumb() {
        assert!(is_valid_crumb("aBc.De/f1"));
        assert!(!is_valid_crumb("<html>"));
        assert!(!is_valid_crumb(""));
        assert!(!is_valid_crumb("Too Many Requests"));
    }
}
