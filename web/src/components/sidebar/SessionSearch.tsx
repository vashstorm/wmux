import { TextField, InputAdornment, Box } from "@mui/material"
import SearchIcon from "@mui/icons-material/Search"
import { alpha } from "@mui/material/styles"
import { memo } from "react"

interface SessionSearchProps {
  value: string
  onChange: (value: string) => void
}

export const SessionSearch = memo(function SessionSearch({ value, onChange }: SessionSearchProps) {
  return (
    <Box
      sx={{
        py: "var(--spacing-md)",
        px: "var(--spacing-lg)",
        mx: "calc(-1 * var(--spacing-lg))",
        mb: "var(--spacing-md)",
        display: "flex",
        alignItems: "center",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <TextField
        fullWidth
        size="small"
        placeholder="Search sessions"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="session-search"
        aria-label="Search sessions"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
              </InputAdornment>
            ),
          },
        }}
        sx={{
          "& .MuiInputBase-root": {
            pl: 0.5,
            bgcolor: "background.paper",
            borderRadius: 1,
            transition: "box-shadow 200ms ease, border-color 200ms ease",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "divider",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
            },
            "&.Mui-focused": {
              boxShadow: (theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.1)}`,
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: "primary.main",
              borderWidth: 2,
            },
            "& input": {
              color: "text.primary",
              fontSize: "var(--font-size-xs)",
              py: "8px",
            },
            "& input::placeholder": {
              color: "text.disabled",
            },
          },
        }}
      />
    </Box>
  )
})
