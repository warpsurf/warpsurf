#!/bin/bash
# Usage: ./update_version.sh <new_version|patch|minor|major>
# Examples:
#   ./update_version.sh 1.2.3   # Set explicit version
#   ./update_version.sh patch   # 1.0.4 → 1.0.5
#   ./update_version.sh minor   # 1.0.4 → 1.1.0
#   ./update_version.sh major   # 1.0.4 → 2.0.0

# Get current version from root package.json
get_current_version() {
  grep -o '"version": "[^"]*' package.json | cut -d'"' -f4
}

# Calculate new version based on bump type
bump_version() {
  local current="$1"
  local bump_type="$2"
  
  # Parse version components
  local major=$(echo "$current" | cut -d. -f1)
  local minor=$(echo "$current" | cut -d. -f2)
  local patch=$(echo "$current" | cut -d. -f3)
  
  case "$bump_type" in
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    patch)
      patch=$((patch + 1))
      ;;
  esac
  
  echo "${major}.${minor}.${patch}"
}

# Update all package.json files with new version
update_all_packages() {
  local new_version="$1"
  
  find . -name 'package.json' -not -path '*/node_modules/*' -exec bash -c '
    # Parse the version from package.json
    current_version=$(grep -o "\"version\": \"[^\"]*" "$0" | cut -d"\"" -f4)
    # Update the version
    perl -i -pe"s/$current_version/'"$new_version"'/" "$0"
  ' {} \;
}

# Main logic
if [[ -z "$1" ]]; then
  echo "Usage: ./update_version.sh <new_version|patch|minor|major>"
  echo "  Examples:"
  echo "    ./update_version.sh 1.2.3   # Set explicit version"
  echo "    ./update_version.sh patch   # Increment patch version"
  echo "    ./update_version.sh minor   # Increment minor version"
  echo "    ./update_version.sh major   # Increment major version"
  exit 1
fi

current_version=$(get_current_version)

if [[ -z "$current_version" ]]; then
  echo "Error: Could not read current version from package.json"
  exit 1
fi

case "$1" in
  patch|minor|major)
    new_version=$(bump_version "$current_version" "$1")
    echo "Bumping $1 version: $current_version → $new_version"
    ;;
  *)
    if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      new_version="$1"
      echo "Setting version: $current_version → $new_version"
    else
      echo "Error: Version format <$1> isn't correct"
      echo "Use format <X.Y.Z> or keywords: patch, minor, major"
      exit 1
    fi
    ;;
esac

update_all_packages "$new_version"
echo "✓ Updated all package.json files to version $new_version"
