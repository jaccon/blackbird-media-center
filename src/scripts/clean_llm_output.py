import json
import re
import sys
import argparse

def extract_json_from_markdown(text):
    """
    Extracts JSON content from text that might contain markdown code blocks.
    """
    text = text.strip()
    # Pattern to match ```json ... ``` or ``` ... ```
    pattern = r'^```(?:json)?\s*(.*?)\s*```$'
    match = re.match(pattern, text, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return text

def generate_metadata(data):
    """
    Generates metadata for the JSON structure.
    """
    metadata = {}
    if isinstance(data, dict):
        metadata["type"] = "object"
        metadata["keys"] = list(data.keys())
        metadata["size"] = len(data)
        # Check for nested structures
        nested = {}
        for k, v in data.items():
            if isinstance(v, dict):
                nested[k] = {"type": "object", "keys": list(v.keys())}
            elif isinstance(v, list):
                nested[k] = {"type": "list", "size": len(v)}
        if nested:
            metadata["nested_structures"] = nested
    elif isinstance(data, list):
        metadata["type"] = "list"
        metadata["size"] = len(data)
        if len(data) > 0 and isinstance(data[0], dict):
            metadata["item_type"] = "object"
            metadata["item_keys"] = list(data[0].keys())
        else:
            metadata["item_type"] = type(data[0]).__name__ if len(data) > 0 else "unknown"
    else:
        metadata["type"] = type(data).__name__
        
    metadata["description"] = (
        "Cleaned output of text elements dynamic formatting check. "
        "Processed to ensure standard JSON structure and key validation."
    )
    return metadata

def parse_args():
    parser = argparse.ArgumentParser(description="Clean output files directly by format dynamically standard structure using key validation.")
    parser.add_argument("--input_path", type=str, required=True, help="Path to the input JSON file (containing the LLM response).")
    parser.add_argument("--output_path", type=str, required=True, help="Path to save the output cleaned JSON.")
    parser.add_argument("--metadata_path", type=str, required=True, help="Path to save the generated metadata JSON.")
    
    return parser.parse_args()

if __name__ == "__main__":
    args = parse_args()
    
    # 1. Read input JSON
    try:
        with open(args.input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading input JSON: {e}")
        sys.exit(1)
        
    # 2. Extract content from the JSON structures (can handle list or dict)
    content = ""
    if isinstance(data, list):
        # concatenate the contents of list items
        contents = []
        for idx, item in enumerate(data):
            if isinstance(item, dict):
                # prioritize 'content'
                if 'content' in item and item['content']:
                    contents.append(str(item['content']))
                elif 'text' in item and item['text']:
                    contents.append(str(item['text']))
                elif 'response' in item and item['response']:
                    contents.append(str(item['response']))
                else:
                    contents.append(json.dumps(item))
            else:
                contents.append(str(item))
        content = "\n\n".join(contents)
    elif isinstance(data, dict):
        if 'content' in data and data['content']:
            content = str(data['content'])
        elif 'text' in data and data['text']:
            content = str(data['text'])
        elif 'response' in data and data['response']:
            content = str(data['response'])
        else:
            content = json.dumps(data)
    else:
        content = str(data)
        
    # 3. Clean the content (removing markdown code fences)
    cleaned_content = extract_json_from_markdown(content)
    
    # 4. Attempt to parse as JSON
    parsed_json = None
    try:
        parsed_json = json.loads(cleaned_content)
        print("Successfully parsed cleaned content as JSON.")
    except Exception as e:
        print(f"Cleaned content is not valid JSON: {e}")
        # If it failed, we can try to extract json from the string using regex
        match = re.search(r'(\{.*\}|\[.*\])', cleaned_content, re.DOTALL)
        if match:
            try:
                parsed_json = json.loads(match.group(1))
                print("Successfully parsed JSON via regex extraction.")
            except Exception as e2:
                print(f"Regex extraction also failed to parse as JSON: {e2}")
    
    # 5. If JSON parsing failed, create a structured object representing the text
    if parsed_json is None:
        print("Falling back to creating a structured object from the text.")
        parsed_json = {
            "raw_text": cleaned_content,
            "error": "Failed to parse original response as valid JSON, raw text is preserved here."
        }
    
    # 6. Save the output cleaned JSON
    try:
        with open(args.output_path, 'w', encoding='utf-8') as f:
            json.dump(parsed_json, f, indent=2, ensure_ascii=False)
        print(f"Saved cleaned JSON to {args.output_path}")
    except Exception as e:
        print(f"Error writing output JSON: {e}")
        sys.exit(1)
        
    # 7. Generate and save metadata
    metadata = generate_metadata(parsed_json)
    try:
        with open(args.metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        print(f"Saved metadata to {args.metadata_path}")
    except Exception as e:
        print(f"Error writing metadata JSON: {e}")
        sys.exit(1)
        
    print("Cleanup completed successfully!")
