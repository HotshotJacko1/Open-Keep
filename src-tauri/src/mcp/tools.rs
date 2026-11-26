// Copyright (c) 2026. Licensed under AGPLv3.
//
// The relay's tool list. tools.json is generated from the Node server's own
// tools/list (mcp-server: `npm run export-tools`), so mcp-server/src/server.ts
// stays the one place the 15 tools are defined; `npm test` there fails while
// the JSON is stale.

use std::sync::OnceLock;

use serde_json::{Map, Value};

pub fn list() -> &'static Vec<Value> {
    static TOOLS: OnceLock<Vec<Value>> = OnceLock::new();
    TOOLS.get_or_init(|| serde_json::from_str(include_str!("tools.json")).expect("tools.json is valid JSON"))
}

pub fn find(name: &str) -> Option<&'static Value> {
    list().iter().find(|t| t.get("name").and_then(Value::as_str) == Some(name))
}

/// Checks arguments against a tool's input schema the way the Node server's
/// zod schemas do, for the small part of JSON Schema the tools use (string,
/// array of strings, minLength, minItems, required, default). Like zod, it
/// drops unknown keys and fills in defaults; the result is what the app gets.
pub fn validate(tool: &Value, args: &Value) -> Result<Value, String> {
    let empty = Map::new();
    let args = match args {
        Value::Null => &empty,
        Value::Object(map) => map,
        _ => return Err("expected an object of arguments".into()),
    };
    let schema = &tool["inputSchema"];
    let required: Vec<&str> = schema["required"].as_array().map(|r| r.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let mut out = Map::new();
    let Some(properties) = schema["properties"].as_object() else {
        return Ok(Value::Object(out));
    };
    for (key, prop) in properties {
        let value = match args.get(key) {
            Some(Value::Null) | None => match prop.get("default") {
                Some(default) => default.clone(),
                None if required.contains(&key.as_str()) => return Err(format!("\"{key}\" is required")),
                None => continue,
            },
            Some(v) => v.clone(),
        };
        check(key, prop, &value)?;
        out.insert(key.clone(), value);
    }
    Ok(Value::Object(out))
}

fn check(key: &str, prop: &Value, value: &Value) -> Result<(), String> {
    match prop["type"].as_str() {
        Some("string") => {
            let s = value.as_str().ok_or_else(|| format!("\"{key}\" must be a string"))?;
            if let Some(min) = prop["minLength"].as_u64() {
                // zod counts UTF-16 code units.
                if (s.encode_utf16().count() as u64) < min {
                    return Err(format!("\"{key}\" must be at least {min} character(s)"));
                }
            }
        }
        Some("array") => {
            let items = value.as_array().ok_or_else(|| format!("\"{key}\" must be an array"))?;
            if let Some(min) = prop["minItems"].as_u64() {
                if (items.len() as u64) < min {
                    return Err(format!("\"{key}\" must have at least {min} item(s)"));
                }
            }
            for item in items {
                check(key, &prop["items"], item)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lists_the_fifteen_tools() {
        assert_eq!(list().len(), 15);
        assert!(find("create_note").is_some());
        assert!(find("nope").is_none());
    }

    #[test]
    fn validates_like_zod() {
        let create = find("create_note").unwrap();
        assert_eq!(validate(create, &json!({ "title": "A" })).unwrap(), json!({ "title": "A", "content": "" }));
        assert!(validate(create, &json!({ "title": "" })).is_err());
        assert!(validate(create, &json!({})).is_err());
        assert_eq!(
            validate(create, &json!({ "title": "A", "content": "b", "extra": 1, "tags": ["x"] })).unwrap(),
            json!({ "title": "A", "content": "b", "tags": ["x"] })
        );
        assert!(validate(create, &json!({ "title": "A", "tags": [1] })).is_err());
        let add = find("add_tags_to_note").unwrap();
        assert!(validate(add, &json!({ "id": "n", "tags": [] })).is_err());
        assert_eq!(validate(find("list_tags").unwrap(), &Value::Null).unwrap(), json!({}));
    }
}
