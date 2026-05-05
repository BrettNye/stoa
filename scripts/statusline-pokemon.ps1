# statusline-pokemon.ps1 — emit a one-line statusline summary for the active vault Pokemon.
# Usage: $env:STOA_VAULT_PATH=<path>; [$env:VAULT_POKEMON=<profile-id>]; .\statusline-pokemon.ps1

param()

$ErrorActionPreference = "Stop"
$VaultPath = $env:STOA_VAULT_PATH
if (-not $VaultPath) { Write-Output "🛑 STOA_VAULT_PATH unset"; exit 0 }
$ProfilesPath = Join-Path (Join-Path $VaultPath "_index") "profiles.json"
if (-not (Test-Path $ProfilesPath)) { Write-Output "🛑 no profiles.json"; exit 0 }

$ProfilesData = Get-Content $ProfilesPath -Raw | ConvertFrom-Json

$Pokemon = $env:VAULT_POKEMON
if (-not $Pokemon) {
  $Pokemon = ($ProfilesData.PSObject.Properties | Select-Object -First 1).Name
}
if (-not $Pokemon) { Write-Output "🛑 no profiles"; exit 0 }

$Profile = $ProfilesData.$Pokemon
if (-not $Profile) { Write-Output "🛑 profile not found: $Pokemon"; exit 2 }

$Bare = if ($Profile.id.StartsWith("profile-")) { $Profile.id.Substring("profile-".Length) } else { $Profile.id }
$Type = $Profile.pokemon_type

$EmojiMap = @{
  fire="🔥"; water="💧"; grass="🌿"; electric="⚡"; ghost="👻"; psychic="🔮";
  dragon="🐉"; dark="🌑"; fairy="✨"; fighting="🥊"; ice="❄️"; rock="🪨";
  ground="⛰️"; flying="🪶"; bug="🐛"; poison="☠️"; steel="⚙️"; normal="⚪"
}
$Emoji = if ($EmojiMap.ContainsKey($Type)) { $EmojiMap[$Type] } else { "⚪" }

$Title = $Bare.Substring(0,1).ToUpper() + $Bare.Substring(1).ToLower()
$TaskLabel = if ($Profile.tasks_in_flight -eq 1) { "task" } else { "tasks" }
Write-Output "$Emoji $Title · $($Profile.tasks_in_flight) $TaskLabel · $($Profile.tasks_completed) done"
