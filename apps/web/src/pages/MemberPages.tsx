import { CaretRightIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { Button, Panel } from "@shared-ledger/ui";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Page } from "../components/layout/Page";

const members = [
  { name: "张三", role: "创建者" },
  { name: "李四", role: "管理员" },
  { name: "王五", role: "成员" },
];

export function MembersPage() {
  return (
    <>
      <Page
        title="成员管理"
        action={
          <Link className="text-action" to="/members/invite">
            邀请
          </Link>
        }
      />
      <Panel>
        {members.map((member) => (
          <Link to="/members/role" className="member-row" key={member.name}>
            <span>{member.name.slice(0, 1)}</span>
            <div>
              <strong>{member.name}</strong>
              <small>{member.role}</small>
            </div>
            <CaretRightIcon />
          </Link>
        ))}
      </Panel>
      <Link className="sub-action" to="/invitations/received">
        我的邀请 <CaretRightIcon />
      </Link>
      <Link className="sub-action" to="/invitations/sent">
        已发邀请 <CaretRightIcon />
      </Link>
    </>
  );
}

export function InviteMemberPage() {
  const [sent, setSent] = useState(false);

  return (
    <>
      <Page title="邀请成员" />
      <div className="form">
        <label>
          邮箱或手机号
          <input placeholder="输入对方邮箱或手机号" />
        </label>
        <label>
          成员角色
          <select>
            <option>成员</option>
            <option>管理员</option>
          </select>
        </label>
        <Button onClick={() => setSent(true)}>{sent ? "已发送邀请" : "发送邀请"}</Button>
        {sent && (
          <p className="success-note">
            <CheckCircleIcon /> 邀请已发送，对方接受后将加入账本。
          </p>
        )}
      </div>
    </>
  );
}

export function MemberRolePage() {
  return (
    <>
      <Page title="成员权限" />
      <Panel className="role-intro">
        <span>李</span>
        <h2>李四</h2>
        <p>可查看与记录账本数据</p>
      </Panel>
      <div className="role-options">
        {["管理员", "成员"].map((role, index) => (
          <label key={role}>
            <input type="radio" name="role" defaultChecked={index === 0} />
            {role}
            <small>{index === 0 ? "可邀请成员、管理成员" : "可查看账本并记录"}</small>
          </label>
        ))}
      </div>
      <Button>保存权限</Button>
    </>
  );
}
