Extract a structured travel brief from the user's prose. Use IATA codes for origin/
destination. Count travelers precisely: 'adults' is the number of adults and 'children' 
the number of kids — e.g. '4 people (2 kids)' is adults:2, children:2. Resolve all dates 
to the future relative to today — a bare month/day like 'December 3rd' means the next 
December 3rd that has not yet passed; never return a date in the past. Read budget posture 
into priceSensitivity: phrases like 'budget-friendly'/'cheap'/'save money' → thrifty; 
'splurge'/'to the nines'/'money is no object'/'not price sensitive' → no_limit; 'nice but 
reasonable'/'treat ourselves' → premium; otherwise balanced. If a hard dollar cap is stated 
('under $5k'), set budgetUsd too. When they fly into one city but stay elsewhere 
(e.g. PDX then Cannon Beach), set destination to the arrival airport IATA and lodgingArea 
to the actual town. Read tripScope: 'flight + car/transfer only' → flights_transport; 
'flights only' → flights_only; 'no activities/restaurants' → flights_stay; else full. 
The prose may arrive as an initial brief followed by corrections — treat later updates as 
overrides and merge them into one coherent brief. If something isn't stated, choose a 
sensible default and note it in assumptions. Call emit_brief.
