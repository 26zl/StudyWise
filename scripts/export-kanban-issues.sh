#!/bin/bash
# =============================================================================
# export-kanban-issues.sh
#
# Eksporterer alle issues fra Kanban-prosjektet (#21) til en tekstfil.
# Krever gh CLI med project scope:
#   gh auth refresh -s read:project -s project
#
# Bruk:
#   bash scripts/export-kanban-issues.sh
#
# Output: filer_prosjekt/kanban-brukerhistorier.txt
# =============================================================================

set -e

PROJECT_NUMBER=21
OWNER=26zl
OUTPUT_FILE="filer_prosjekt/kanban-brukerhistorier.txt"

echo "Henter issues fra Kanban (#${PROJECT_NUMBER})..."

# Hent alle items som JSON
ITEMS=$(gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json --limit 500)

# Tell statuser
TOTAL=$(echo "$ITEMS" | python3 -c "import sys,json; print(json.load(sys.stdin)['totalCount'])")
IN_PROGRESS=$(echo "$ITEMS" | python3 -c "import sys,json; print(sum(1 for i in json.load(sys.stdin)['items'] if i['status']=='In progress'))")
IN_REVIEW=$(echo "$ITEMS" | python3 -c "import sys,json; print(sum(1 for i in json.load(sys.stdin)['items'] if i['status']=='In review'))")
DONE=$(echo "$ITEMS" | python3 -c "import sys,json; print(sum(1 for i in json.load(sys.stdin)['items'] if i['status']=='Done'))")
TODO=$(echo "$ITEMS" | python3 -c "import sys,json; print(sum(1 for i in json.load(sys.stdin)['items'] if i['status']=='Todo'))")

# Generer tekstfil
mkdir -p "$(dirname "$OUTPUT_FILE")"

python3 -c "
import json, sys
from datetime import datetime

data = json.loads('''$(echo "$ITEMS" | sed "s/'/\\\\'/g")''')
items = data['items']

lines = []
lines.append('Kanban — StudyWise Brukerhistorier')
lines.append('=' * 36)
lines.append(f'Totalt {len(items)} brukerhistorier fra GitHub Projects (#{${PROJECT_NUMBER}}).')
lines.append(f'Eksportert: {datetime.now().strftime(\"%Y-%m-%d %H:%M\")}')
lines.append('')

# Grupper etter status
status_order = ['In progress', 'In review', 'Todo', 'Done']
counter = 1

for status in status_order:
    group = [i for i in items if i['status'] == status]
    if not group:
        continue
    lines.append('=' * 78)
    lines.append(f'{status.upper()} ({len(group)})')
    lines.append('=' * 78)
    for item in group:
        content = item.get('content', {})
        number = content.get('number', '?')
        title = content.get('title', item.get('title', ''))
        assignees = ', '.join(item.get('assignees', []))
        lines.append(f'{counter:>3}. [#{number}] {title}')
        if assignees:
            lines.append(f'     Tildelt: {assignees}')
        counter += 1
    lines.append('')

print('\n'.join(lines))
" > "$OUTPUT_FILE"

echo "Eksportert $TOTAL issues til $OUTPUT_FILE"
echo "  In progress: $IN_PROGRESS"
echo "  In review:   $IN_REVIEW"
echo "  Todo:        $TODO"
echo "  Done:        $DONE"
