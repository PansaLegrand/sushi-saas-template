import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function AdminTable({
  caption,
  className,
  containerClassName,
  children,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & {
  caption: string;
  containerClassName?: string;
}) {
  return (
    <Card className={cn("overflow-hidden shadow-sm", containerClassName)}>
      <Table className={cn("leading-6", className)} {...props}>
        <TableCaption className="sr-only">{caption}</TableCaption>
        {children}
      </Table>
    </Card>
  );
}

export function AdminTableHeader({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <TableHeader
      className={cn(
        "bg-muted/50 text-left text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function AdminTableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <TableBody
      className={cn("[&_tr:last-child]:border-b-0", className)}
      {...props}
    />
  );
}

export function AdminTableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <TableRow
      className={cn("align-top hover:bg-muted/35", className)}
      {...props}
    />
  );
}

export function AdminTableHead({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <TableHead
      className={cn(
        "h-12 whitespace-nowrap px-4 text-left align-middle font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function AdminTableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <TableCell className={cn("px-4 py-3 align-top", className)} {...props} />
  );
}

export function AdminTableEmpty({
  colSpan,
  title,
  description,
}: {
  colSpan: number;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <AdminTableRow className="hover:bg-transparent">
      <AdminTableCell colSpan={colSpan} className="h-36 text-center">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </AdminTableCell>
    </AdminTableRow>
  );
}
