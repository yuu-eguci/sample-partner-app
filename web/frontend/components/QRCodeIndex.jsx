/*
  NOTE: Getting started の通りにコピペしたもの。
        https://shopify.dev/apps/getting-started/build-app-example/frontend
*/
import { useNavigate } from "@shopify/app-bridge-react";
import {
  LegacyCard,
  Icon,
  IndexTable,
  LegacyStack,
  Text,
  Thumbnail,
  UnstyledLink,
} from "@shopify/polaris";
import { AlertDiamondIcon, ImageIcon } from "@shopify/polaris-icons";

/* useMedia is used to support multiple screen sizes */
import { useMedia } from "@shopify/react-hooks";

/* dayjs is used to capture and format the date a QR code was created or modified */
import dayjs from "dayjs";

/* Markup for small screen sizes (mobile) */
function SmallScreenCard({
  id,
  title,
  product,
  discountCode,
  scans,
  createdAt,
  navigate,
}) {
  return (
    <UnstyledLink onClick={() => navigate(`/qrcodes/${id}`)}>
      <div
        style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #E1E3E5" }}
      >
        <LegacyStack>
          <LegacyStack.Item>
            <Thumbnail
              source={product?.images?.edges[0]?.node?.url || ImageIcon}
              alt="placeholder"
              size="small"
            />
          </LegacyStack.Item>
          <LegacyStack.Item fill>
            <LegacyStack vertical={true}>
              <LegacyStack.Item>
                <p>
                  <Text as="span" fontWeight="bold">
                    {truncate(title, 35)}
                  </Text>
                </p>
                <p>{truncate(product?.title, 35)}</p>
                <p>{dayjs(createdAt).format("MMMM D, YYYY")}</p>
              </LegacyStack.Item>
              <div style={{ display: "flex" }}>
                <div style={{ flex: "3" }}>
                  <Text as="span" tone="subdued">Discount</Text>
                  <p>{discountCode || "-"}</p>
                </div>
                <div style={{ flex: "2" }}>
                  <Text as="span" tone="subdued">Scans</Text>
                  <p>{scans}</p>
                </div>
              </div>
            </LegacyStack>
          </LegacyStack.Item>
        </LegacyStack>
      </div>
    </UnstyledLink>
  );
}

export function QRCodeIndex({ QRCodes, loading }) {
  const navigate = useNavigate();

  /* Check if screen is small */
  const isSmallScreen = useMedia("(max-width: 640px)");

  /* Map over QRCodes for small screen */
  const smallScreenMarkup = QRCodes.map((QRCode) => (
    <SmallScreenCard key={QRCode.id} navigate={navigate} {...QRCode} />
  ));

  const resourceName = {
    singular: "QR code",
    plural: "QR codes",
  };

  const rowMarkup = QRCodes.map(
    ({ id, title, product, discountCode, scans, createdAt }, index) => {
      const deletedProduct = product.title.includes("Deleted product");

      /* The form layout, created using Polaris components. Includes the QR code data set above. */
      return (
        <IndexTable.Row
          id={id}
          key={id}
          position={index}
          onClick={() => {
            navigate(`/qrcodes/${id}`);
          }}
        >
          <IndexTable.Cell>
            <Thumbnail
              source={product?.images?.edges[0]?.node?.url || ImageIcon}
              alt="placeholder"
              size="small"
            />
          </IndexTable.Cell>
          <IndexTable.Cell>
            <UnstyledLink data-primary-link url={`/qrcodes/${id}`}>
              {truncate(title, 25)}
            </UnstyledLink>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <LegacyStack>
              {deletedProduct && (
                <Icon source={AlertDiamondIcon} tone="critical" />
              )}
              <Text as="span" tone={deletedProduct ? "critical" : undefined}>
                {truncate(product?.title, 25)}
              </Text>
            </LegacyStack>
          </IndexTable.Cell>
          <IndexTable.Cell>{discountCode}</IndexTable.Cell>
          <IndexTable.Cell>
            {dayjs(createdAt).format("MMMM D, YYYY")}
          </IndexTable.Cell>
          <IndexTable.Cell>{scans}</IndexTable.Cell>
        </IndexTable.Row>
      );
    }
  );

  /* A layout for small screens, built using Polaris components */
  return (
    <LegacyCard>
      {isSmallScreen ? (
        smallScreenMarkup
      ) : (
        <IndexTable
          resourceName={resourceName}
          itemCount={QRCodes.length}
          headings={[
            { title: "Thumbnail", hidden: true },
            { title: "Title" },
            { title: "Product" },
            { title: "Discount" },
            { title: "Date created" },
            { title: "Scans" },
          ]}
          selectable={false}
          loading={loading}
        >
          {rowMarkup}
        </IndexTable>
      )}
    </LegacyCard>
  );
}

/* A function to truncate long strings */
function truncate(str, n) {
  return str.length > n ? str.substr(0, n - 1) + "…" : str;
}
