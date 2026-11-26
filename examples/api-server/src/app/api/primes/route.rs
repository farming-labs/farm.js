use wstd::http::body::IncomingBody;
use wstd::http::server::{Finished, Responder};
use wstd::http::{IntoBody, Method, Request, Response, StatusCode};

const DEFAULT_LIMIT: u32 = 10_000;
const MAX_LIMIT: u32 = 5_000_000;

fn count_primes(limit: u32) -> u32 {
    (2..limit)
        .filter(|&candidate| {
            (2..)
                .take_while(|d| d * d <= candidate)
                .all(|d| candidate % d != 0)
        })
        .count() as u32
}

#[wstd::http_server]
async fn main(request: Request<IncomingBody>, responder: Responder) -> Finished {
    if request.method() != Method::GET {
        let response = Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header("allow", "GET")
            .body("".into_body())
            .unwrap();
        return responder.respond(response).await;
    }

    let limit = request
        .uri()
        .query()
        .and_then(|query| {
            query
                .split('&')
                .find_map(|pair| pair.strip_prefix("limit="))
        })
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(DEFAULT_LIMIT)
        .min(MAX_LIMIT);

    let body = format!(r#"{{"limit":{limit},"primes":{}}}"#, count_primes(limit));
    let response = Response::builder()
        .header("content-type", "application/json")
        .body(body.into_body())
        .unwrap();
    responder.respond(response).await
}
