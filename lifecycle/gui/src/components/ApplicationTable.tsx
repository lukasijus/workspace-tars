import { useNavigate } from "react-router-dom";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from "@mui/material";
import { ArtifactPreview } from "./ArtifactPreview";
import { StatusChip } from "./StatusChip";
import type { ApplicationRow } from "../types";

interface ApplicationTableProps {
  title?: string;
  rows: ApplicationRow[];
  emptyLabel?: string;
  count?: number;
  page?: number;
  rowsPerPage?: number;
  onPageChange?: (event: unknown, newPage: number) => void;
  onRowsPerPageChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function roleLabel(row: ApplicationRow) {
  return [row.company, row.title].filter(Boolean).join(" — ") || `Application ${row.id}`;
}

export function ApplicationTable({
  title,
  rows,
  emptyLabel = "No items",
  count,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
}: ApplicationTableProps) {
  const navigate = useNavigate();

  return (
    <Box>
      {title && (
        <Typography variant="h5" gutterBottom>
          {title}
        </Typography>
      )}
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{ border: "1px solid", borderColor: "divider", overflow: "hidden" }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Role</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created Date</TableCell>
              <TableCell>Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow
                  hover
                  key={String(row.id)}
                  tabIndex={0}
                  role="link"
                  onClick={() => navigate(`/applications/${row.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/applications/${row.id}`);
                    }
                  }}
                  sx={{
                    cursor: "pointer",
                    "&:focus-visible": {
                      outline: "2px solid",
                      outlineColor: "primary.main",
                      outlineOffset: -2,
                    },
                  }}
                >
                  <TableCell sx={{ maxWidth: 350 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800 }}>
                      {roleLabel(row)}
                    </Typography>
                    {row.flow_type ? (
                      <Typography color="primary" variant="caption">
                        {row.flow_type}
                      </Typography>
                    ) : null}
                    {row.is_active === false ? (
                      <Typography color="error" variant="caption" sx={{ display: "block" }}>
                        Inactive: {row.inactive_reason || "closed"}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.location || "unknown"}</TableCell>
                  <TableCell>
                    <StatusChip status={row.status} />
                  </TableCell>
                  <TableCell>
                    {row.created_at ? (
                      <Box sx={{ display: "flex", flexDirection: "column" }}>
                        <Typography variant="body2" noWrap>
                          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(row.created_at))}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(row.created_at))}
                        </Typography>
                      </Box>
                    ) : (
                      "unknown"
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 400 }}>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {row.summary_reason || "No details yet"}
                    </Typography>
                    <Box sx={{ mt: 1 }}>
                      <ArtifactPreview
                        imageArtifactId={row.latest_image_artifact_id}
                        htmlArtifactId={row.latest_html_artifact_id}
                      />
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5}>{emptyLabel}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {count !== undefined && page !== undefined && rowsPerPage !== undefined && onPageChange && onRowsPerPageChange && (
          <TablePagination
            component="div"
            count={count}
            page={page}
            onPageChange={onPageChange}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={onRowsPerPageChange}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        )}
      </TableContainer>
    </Box>
  );
}
