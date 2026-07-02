import { zodResolver } from "@hookform/resolvers/zod";
import { WalletIcon } from "@phosphor-icons/react";
import { createBookSchema } from "@shared-ledger/shared";
import {
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@shared-ledger/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { IconTile, IosButton, IosCard, IosField, IosScroll, IosTopBar } from "../components/ios/IosDesign";
import { writeLastActiveBookId } from "../hooks/useActiveBook";
import { api } from "../lib";

type Book = { id: string; name: string; currency: string };

export function CreateBookPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const source = new URLSearchParams(location.search).get("source");
  const fromManage = source === "manage";
  const form = useForm({
    resolver: zodResolver(createBookSchema),
    defaultValues: { name: "", currency: "CNY", note: "" },
  });
  const [error, setError] = useState("");
  const currency = form.watch("currency");
  const submit = form.handleSubmit(async (value) => {
    try {
      const result = await api<{ book: Book }>("/books", { method: "POST", body: JSON.stringify(value) });
      if (fromManage) {
        navigate("/books/manage");
      } else {
        writeLastActiveBookId(result.book.id);
        navigate(`/home?bookId=${result.book.id}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    }
  });
  return (
    <form className="ios-create-book-screen" onSubmit={submit}>
      <IosTopBar title="创建账本" back onBack={() => navigate(fromManage ? "/books/manage" : "/home")} />
      <IosScroll className="ios-create-book-scroll">
        <section className="ios-create-book-hero">
          <IconTile>
            <WalletIcon size={28} weight="fill" />
          </IconTile>
          <h1>创建一个新账本</h1>
          <p>用于家庭、旅行、合租或任何需要多人共同维护的收支场景。</p>
        </section>
        <IosCard className="ios-form-card">
          <IosField label="账本名称" error={form.formState.errors.name?.message}>
            <Input placeholder="例如：家庭账本" {...form.register("name")} />
          </IosField>
          <IosField label="默认货币">
            <Select
              value={currency}
              onValueChange={(value) =>
                form.setValue("currency", value, { shouldDirty: true, shouldValidate: true })
              }
            >
              <SelectTrigger aria-label="默认货币">
                <SelectValue placeholder="请选择货币" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="CNY">CNY 人民币</SelectItem>
                  <SelectItem value="USD">USD 美元</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </IosField>
          <IosField label="备注（可选）">
            <Textarea placeholder="这个账本用来记录什么？" maxLength={100} {...form.register("note")} />
          </IosField>
        </IosCard>
        {error && <p className="field-error">{error}</p>}
      </IosScroll>
      <footer className="ios-fixed-footer">
        <IosButton type="submit">创建账本</IosButton>
      </footer>
    </form>
  );
}
