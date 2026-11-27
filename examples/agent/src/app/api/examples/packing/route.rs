use wstd::http::body::IncomingBody;
use wstd::http::server::{Finished, Responder};
use wstd::http::{IntoBody, Method, Request, Response, StatusCode};

const BAGS_PER_BOX: u32 = 4;

#[wstd::http_server]
async fn main(request: Request<IncomingBody>, responder: Responder) -> Finished {
    let response = Response::builder().header("content-type", "application/json");
    if request.method() != Method::GET {
        return responder
            .respond(
                response
                    .status(StatusCode::METHOD_NOT_ALLOWED)
                    .header("allow", "GET")
                    .body(r#"{"error":"Use GET to request a packing plan."}"#.into_body())
                    .unwrap(),
            )
            .await;
    }

    let mut quantities = request
        .uri()
        .query()
        .unwrap_or_default()
        .split('&')
        .map(|pair| pair.split_once('=').unwrap_or((pair, "")))
        .filter_map(|(name, value)| (name == "quantity").then_some(value));
    let quantity = quantities
        .next()
        .and_then(|value| value.parse::<u32>().ok());
    let (status, body) = match (quantity, quantities.next()) {
        (Some(quantity @ 1..=20), None) => (
            StatusCode::OK,
            format!(
                r#"{{"quantity":{quantity},"bagsPerBox":{BAGS_PER_BOX},"boxes":{}}}"#,
                quantity.div_ceil(BAGS_PER_BOX)
            ),
        ),
        _ => (
            StatusCode::BAD_REQUEST,
            r#"{"error":"Supply one quantity between 1 and 20."}"#.to_owned(),
        ),
    };
    responder
        .respond(response.status(status).body(body.into_body()).unwrap())
        .await
}
