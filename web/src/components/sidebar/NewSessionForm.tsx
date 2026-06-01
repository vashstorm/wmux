import { TextField, Button, Stack, Box } from "@mui/material"
import { alpha } from "@mui/material/styles"

interface NewSessionFormProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}

export function NewSessionForm({ value, onChange, onSubmit, onCancel }: NewSessionFormProps) {
  return (
    <Box
      component="form"
      onSubmit={onSubmit}
      sx={{
        p: "var(--spacing-md)",
        bgcolor: "action.hover",
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        my: "var(--spacing-xs)",
      }}
    >
      <TextField
        fullWidth
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Session name"
        autoFocus
        data-testid="new-session-name-input"
        sx={{
          mb: "var(--spacing-sm)",
          "& .MuiInputBase-root": {
            bgcolor: "background.paper",
            borderRadius: 1,
            fontSize: "var(--font-size-xs)",
            color: "text.primary",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "divider",
            },
            "&:focus-within .MuiOutlinedInput-notchedOutline": {
              borderColor: "primary.main",
              boxShadow: (theme) => `0 0 0 2px ${alpha(theme.palette.primary.main, 0.1)}`,
            },
            "& input::placeholder": {
              color: "text.disabled",
            },
          },
        }}
      />
      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
        <Button
          type="button"
          onClick={onCancel}
          size="small"
          variant="outlined"
          sx={{
            px: 1,
            fontSize: "var(--font-size-xs)",
            borderColor: "divider",
            color: "text.primary",
            "&:hover": {
              bgcolor: "action.hover",
              borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
              color: "primary.main",
            },
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="small"
          variant="contained"
          sx={{
            px: 1,
            fontSize: "var(--font-size-xs)",
            bgcolor: "primary.main",
            "&:hover": {
              bgcolor: "primary.dark",
            },
          }}
        >
          Create
        </Button>
      </Stack>
    </Box>
  )
}
